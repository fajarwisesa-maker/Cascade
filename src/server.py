"""CASCADE backend and same-origin host for the dual-mode HTML product."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm import available as llm_available, config_status  # noqa: E402
from qa import Engine  # noqa: E402

ENGINE = Engine()
ENGINE_COMMIT = json.loads((WEB / "bundle.json").read_text(encoding="utf-8"))["meta"]["engine_commit"]
DATA_FINGERPRINT = hashlib.sha256((WEB / "bundle.json").read_bytes()).hexdigest()
HTML = WEB / "dist" / "cascade.html"
MAX_QUERY = 240
MAX_BODY = 16 * 1024
CORS_ORIGIN = os.environ.get("CASCADE_CORS_ORIGIN", "").strip()
DEMO = [
    "GA-1201A tripped on high vibration, can I restart?",
    "why does the hexane pump keep failing?",
    "kenapa pompa hexane bocor?",
    "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?",
    "EA-5601 tripped, can I restart it?",
    "is it safe to keep running GA-1201A at 5 mm/s vibration?",
    "what is the warranty period of GA-1201A?",
]


def fingerprint_payload(answer: dict) -> dict:
    """Fields shared by Python and the in-browser parity engine."""
    return {
        "query": answer.get("query"),
        "status": answer.get("status"),
        "intent": answer.get("intent"),
        "asset": answer.get("asset"),
        "headline": answer.get("headline"),
        "sections": answer.get("sections") or [],
    }


def answer_fingerprint(answer: dict) -> str:
    data = json.dumps(
        fingerprint_payload(answer), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def answer(query: str) -> dict:
    result = ENGINE.ask(query)
    fingerprint = answer_fingerprint(result)
    result["engine_commit"] = ENGINE_COMMIT
    result["data_fingerprint"] = DATA_FINGERPRINT
    result["answer_fingerprint"] = fingerprint
    if "summary" not in result:
        llm = config_status()
        eligible = result.get("status") in {"answered", "refused_deviation"}
        result["summary"] = {
            "status": "unavailable" if eligible else "not_applicable",
            "accepted": False,
            "selected": [],
            "reason": "provider_off" if eligible and not llm.get("configured") else "not_applicable",
            "provider": llm.get("provider", "off"),
            "model": llm.get("model", ""),
            "latency_ms": 0,
        }
    result["summary"].update({
        "engine_commit": ENGINE_COMMIT,
        "data_fingerprint": DATA_FINGERPRINT,
        "answer_fingerprint": fingerprint,
    })
    return result


class Handler(BaseHTTPRequestHandler):
    def _common_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if CORS_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
            self.send_header("Vary", "Origin")

    def _send_json(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self._common_headers()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _send_html(self) -> None:
        if not HTML.is_file():
            return self._send_json(503, {"error": "product HTML has not been built"})
        data = HTML.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self' data:; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            "connect-src 'self'; font-src 'self' data:; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'",
        )
        self._common_headers()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _validated_query(self, query: str) -> str | None:
        query = query.strip()
        if not query:
            self._send_json(400, {"error": "missing query"})
            return None
        if len(query) > MAX_QUERY:
            self._send_json(400, {"error": f"query exceeds {MAX_QUERY} characters"})
            return None
        return query

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        if CORS_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self._common_headers()
        self.end_headers()

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            return self._send_html()
        if parsed.path == "/health":
            llm = config_status()
            return self._send_json(200, {
                "ok": True,
                "engine_commit": ENGINE_COMMIT,
                "data_fingerprint": DATA_FINGERPRINT,
                "retrieval": ENGINE.R.mode,
                "llm_summary": llm_available(),
                "llm": llm,
                "pilot_assets": ["GA-1201A", "EA-5601"],
                "passages": len(ENGINE.R.P),
            })
        if parsed.path == "/ask":
            query = self._validated_query((parse_qs(parsed.query).get("q") or [""])[0])
            if query is not None:
                return self._send_json(200, answer(query))
            return None
        if parsed.path == "/chains":
            return self._send_json(200, {"chains": [
                {key: chain.get(key) for key in (
                    "chain_id", "tag", "equipment", "root_mechanism", "wos",
                    "first_seen", "last_seen", "span_days", "n_events",
                    "total_downtime_h", "total_cost_idr", "confidence",
                    "loss_of_containment", "detectable_on",
                    "first_lesson_shared_on", "lesson_latency_days",
                )}
                for chain in ENGINE.chains
            ]})
        if parsed.path == "/demo":
            return self._send_json(200, {"questions": DEMO})
        return self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/ask":
            return self._send_json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send_json(400, {"error": "invalid content length"})
        if length < 0 or length > MAX_BODY:
            return self._send_json(413, {"error": "request body too large"})
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._send_json(400, {"error": "invalid json"})
        if not isinstance(payload, dict):
            return self._send_json(400, {"error": "invalid json"})
        query = self._validated_query(str(payload.get("query") or ""))
        if query is not None:
            return self._send_json(200, answer(query))
        return None

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[cascade] " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    host = os.environ.get("CASCADE_HOST", "127.0.0.1")
    print(f"CASCADE on http://{host}:{port} (retrieval: {ENGINE.R.mode}, "
          f"LLM selector: {'on' if llm_available() else 'off'})")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
