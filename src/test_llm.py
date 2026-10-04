"""Offline unit tests for provider transports and claim selection."""
from __future__ import annotations

import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llm  # noqa: E402
import llm_client  # noqa: E402


class Response:
    def __init__(self, value: dict):
        self.data = json.dumps(value).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.data


class ProviderTests(unittest.TestCase):
    def call(self, config: llm_client.Config, response: dict):
        captured = {}

        def fake(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response(response)

        with patch("urllib.request.urlopen", fake):
            text, meta = llm_client.complete_json("system", "prompt", 3, config)
        body = json.loads(captured["request"].data)
        return text, meta, captured["request"], body, captured["timeout"]

    def test_default_is_off(self):
        cfg = llm_client.load_config({})
        self.assertEqual(cfg.provider, "off")
        self.assertFalse(cfg.configured)

    def test_anthropic(self):
        cfg = llm_client.Config("anthropic", "model-a", "https://anthropic.test/v1", "secret", 7)
        text, meta, req, body, timeout = self.call(cfg, {"content": [{"type": "text", "text": '{"claims":["C1"]}'}]})
        self.assertEqual(text, '{"claims":["C1"]}')
        self.assertEqual(req.full_url, "https://anthropic.test/v1/messages")
        self.assertEqual(req.get_header("X-api-key"), "secret")
        self.assertEqual(body["system"], "system")
        self.assertEqual(timeout, 7)
        self.assertEqual(meta, {"provider": "anthropic", "model": "model-a"})

    def test_gemini_structured_json(self):
        default = llm_client.load_config({"CASCADE_LLM_PROVIDER": "gemini", "GEMINI_API_KEY": "secret"})
        self.assertEqual(default.model, "gemini-3.8-flash")
        cfg = llm_client.Config("gemini", "flash", "https://gemini.test/v1beta", "secret", 8)
        response = {"candidates": [{"content": {"parts": [{"text": '{"claims":["C2"]}'}]}}]}
        text, _, req, body, _ = self.call(cfg, response)
        self.assertEqual(text, '{"claims":["C2"]}')
        self.assertEqual(req.full_url, "https://gemini.test/v1beta/models/flash:generateContent")
        self.assertEqual(req.get_header("X-goog-api-key"), "secret")
        self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")
        self.assertFalse(body["generationConfig"]["responseSchema"]["additionalProperties"])
        self.assertNotIn("responseFormat", body["generationConfig"])

    def test_openai_groq_and_compatible(self):
        for provider in ("openai", "groq", "openai-compatible"):
            with self.subTest(provider=provider):
                cfg = llm_client.Config(provider, "model", f"https://{provider}.test/v1", "secret", 9)
                response = {"choices": [{"message": {"content": '{"claims":["C1"]}'}}]}
                text, _, req, body, _ = self.call(cfg, response)
                self.assertEqual(text, '{"claims":["C1"]}')
                self.assertTrue(req.full_url.endswith("/chat/completions"))
                self.assertEqual(req.get_header("Authorization"), "Bearer secret")
                self.assertEqual(body["response_format"], {"type": "json_object"})

    def test_ollama(self):
        cfg = llm_client.Config("ollama", "local-model", "http://127.0.0.1:11434", None, 4)
        response = {"message": {"content": '{"claims":["C1"]}'}}
        text, _, req, body, _ = self.call(cfg, response)
        self.assertEqual(text, '{"claims":["C1"]}')
        self.assertEqual(req.full_url, "http://127.0.0.1:11434/api/chat")
        self.assertEqual(body["format"]["properties"]["claims"]["maxItems"], 3)

    def test_http_errors_are_sanitised(self):
        cfg = llm_client.Config("gemini", "flash", "https://secret-host.test", "TOPSECRET", 3)
        error = urllib.error.HTTPError("https://secret-host.test?key=TOPSECRET", 429, "quota body", {}, io.BytesIO(b"secret"))
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(llm_client.ProviderError) as caught:
                llm_client.complete_json("system", "prompt", config=cfg)
        message = str(caught.exception)
        self.assertEqual(message, "provider request failed (HTTP 429)")
        self.assertNotIn("TOPSECRET", message)
        self.assertNotIn("secret-host", message)


class SelectorTests(unittest.TestCase):
    def setUp(self):
        self.answer = {
            "query": "why?", "status": "answered", "headline": "Verified answer",
            "sections": [{"kind": "summary", "items": [
                {"text": "First verified claim", "evidence": ["E1"]},
                {"text": "Second verified claim", "evidence": ["E2"]},
            ]}],
        }

    def test_exact_claims_only(self):
        result = llm.summarize(self.answer, model_fn=lambda _: '{"claims":["C2"]}')
        self.assertTrue(result["accepted"])
        self.assertEqual(result["selected"], [{
            "claim_id": "C2", "text": "Second verified claim",
            "evidence": ["E2"], "section": "summary",
        }])
        self.assertNotIn("raw", result)

    def test_invalid_outputs_fail_closed(self):
        cases = {
            "semantic prose": "The equipment is safe.",
            "unknown": '{"claims":["C9"]}',
            "duplicate": '{"claims":["C1","C1"]}',
            "extra": '{"claims":["C1"],"text":"unsafe"}',
            "empty": '{"claims":[]}',
        }
        for name, raw in cases.items():
            with self.subTest(name=name):
                result = llm.summarize(self.answer, model_fn=lambda _, value=raw: value)
                self.assertFalse(result["accepted"])
                self.assertEqual(result["selected"], [])
                self.assertNotIn(raw, json.dumps(result))

    def test_provider_exception_is_generic(self):
        def fail(_):
            raise RuntimeError("TOPSECRET https://private.example")

        result = llm.summarize(self.answer, model_fn=fail)
        encoded = json.dumps(result)
        self.assertEqual(result["reason"], "provider_error")
        self.assertNotIn("TOPSECRET", encoded)
        self.assertNotIn("private.example", encoded)


if __name__ == "__main__":
    unittest.main(verbosity=2)
