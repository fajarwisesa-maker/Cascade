"""Small, provider-agnostic JSON client for CASCADE's claim selector.

Only the backend imports this module.  Provider credentials are read from the
process environment and are never included in returned metadata or errors.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
import urllib.error
import urllib.request


class ProviderError(RuntimeError):
    """A deliberately sanitised provider failure."""


@dataclass(frozen=True)
class Config:
    provider: str
    model: str
    base_url: str
    api_key: str | None
    timeout_s: float

    @property
    def configured(self) -> bool:
        if self.provider in {"off", ""}:
            return False
        if self.provider == "ollama":
            return bool(self.model)
        if self.provider == "openai-compatible":
            return bool(self.model and self.base_url)
        return bool(self.model and self.api_key)


DEFAULT_MODEL = {
    "anthropic": "claude-haiku-4-5-20251001",
    "openai": "gpt-4o-mini",
    "groq": "llama-3.3-70b-versatile",
    "gemini": "gemini-3.8-flash",
    "ollama": "llama3.1:8b",
    "openai-compatible": "",
}
DEFAULT_BASE = {
    "anthropic": "https://api.anthropic.com/v1",
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "ollama": "http://127.0.0.1:11434",
    "openai-compatible": "http://127.0.0.1:8000/v1",
}
KEY_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openai-compatible": "CASCADE_LLM_API_KEY",
}
PROVIDERS = set(DEFAULT_MODEL) | {"off"}


def load_config(env: dict[str, str] | None = None) -> Config:
    values = os.environ if env is None else env
    provider = values.get("CASCADE_LLM_PROVIDER", "off").strip().lower()
    if provider == "vllm":
        provider = "openai-compatible"
    if provider not in PROVIDERS:
        raise ProviderError("unsupported LLM provider")
    model = values.get("CASCADE_LLM_MODEL", DEFAULT_MODEL.get(provider, "")).strip()
    base = values.get("CASCADE_LLM_BASE_URL", DEFAULT_BASE.get(provider, "")).strip().rstrip("/")
    key_name = KEY_ENV.get(provider, "")
    key = values.get(key_name) if key_name else None
    if provider == "gemini" and not key:
        key = values.get("GOOGLE_API_KEY")
    try:
        timeout = float(values.get("CASCADE_LLM_TIMEOUT_S", "20"))
    except ValueError as exc:
        raise ProviderError("invalid LLM timeout") from exc
    if not 0.1 <= timeout <= 120:
        raise ProviderError("LLM timeout must be between 0.1 and 120 seconds")
    return Config(provider, model, base, key or None, timeout)


def safe_status(config: Config | None = None) -> dict:
    config = config or load_config()
    return {
        "configured": config.configured,
        "provider": config.provider,
        "model": config.model,
    }


def _post_json(url: str, headers: dict[str, str], body: dict, timeout: float) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
    except urllib.error.HTTPError as exc:
        raise ProviderError(f"provider request failed (HTTP {exc.code})") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ProviderError("provider request failed") from None
    try:
        parsed = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderError("provider returned invalid JSON") from None
    if not isinstance(parsed, dict):
        raise ProviderError("provider returned invalid JSON")
    return parsed


def _claim_schema(max_claims: int) -> dict:
    return {
        "type": "object",
        "properties": {
            "claims": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": max_claims,
            }
        },
        "required": ["claims"],
        "additionalProperties": False,
    }


def complete_json(system: str, prompt: str, max_claims: int = 3,
                  config: Config | None = None) -> tuple[str, dict]:
    """Return the provider's text and public, non-secret metadata."""
    cfg = config or load_config()
    if not cfg.configured:
        raise ProviderError("LLM provider is not configured")
    schema = _claim_schema(max_claims)
    p = cfg.provider

    if p == "anthropic":
        data = _post_json(
            cfg.base_url + "/messages",
            {"x-api-key": cfg.api_key or "", "anthropic-version": "2023-06-01"},
            {"model": cfg.model, "max_tokens": 120, "temperature": 0,
             "system": system, "messages": [{"role": "user", "content": prompt}]},
            cfg.timeout_s,
        )
        text = "".join(part.get("text", "") for part in data.get("content", []) if isinstance(part, dict))
    elif p in {"openai", "groq", "openai-compatible"}:
        data = _post_json(
            cfg.base_url + "/chat/completions",
            {"authorization": "Bearer " + (cfg.api_key or "")},
            {"model": cfg.model, "max_tokens": 120, "temperature": 0,
             "response_format": {"type": "json_object"},
             "messages": [{"role": "system", "content": system},
                          {"role": "user", "content": prompt}]},
            cfg.timeout_s,
        )
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise ProviderError("provider response missing content") from None
    elif p == "gemini":
        data = _post_json(
            f"{cfg.base_url}/models/{cfg.model}:generateContent",
            {"x-goog-api-key": cfg.api_key or ""},
            {"systemInstruction": {"parts": [{"text": system}]},
             "contents": [{"role": "user", "parts": [{"text": prompt}]}],
             "generationConfig": {"temperature": 0, "maxOutputTokens": 120,
                                  "responseMimeType": "application/json",
                                  "responseSchema": schema}},
            cfg.timeout_s,
        )
        try:
            text = "".join(part.get("text", "") for part in data["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError, TypeError):
            raise ProviderError("provider response missing content") from None
    elif p == "ollama":
        data = _post_json(
            cfg.base_url + "/api/chat",
            {},
            {"model": cfg.model, "stream": False, "format": schema,
             "options": {"temperature": 0},
             "messages": [{"role": "system", "content": system},
                          {"role": "user", "content": prompt}]},
            cfg.timeout_s,
        )
        try:
            text = data["message"]["content"]
        except (KeyError, TypeError):
            raise ProviderError("provider response missing content") from None
    else:  # defensive; load_config already validates this
        raise ProviderError("unsupported LLM provider")

    if not isinstance(text, str) or not text.strip():
        raise ProviderError("provider response missing content")
    return text, {"provider": cfg.provider, "model": cfg.model}
