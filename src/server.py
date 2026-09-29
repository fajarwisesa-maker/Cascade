"""
CASCADE — HTTP API (stdlib only, no install needed)

  GET  /health               engine status, retrieval mode, LLM on/off
  GET  /ask?q=...            structured answer (JSON)
  POST /ask  {"query": ...}  same
  GET  /chains               detected failure chains with lesson timeline
  GET  /demo                 the validated demo questions for the video

Run:  python3 src/server.py [port]      (default 8765)
"""
from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm import available as llm_available  # noqa: E402
from qa import Engine  # noqa: E402

ENGINE = Engine()
DEMO = [
    "GA-1201A tripped on high vibration, can I restart?",
    "why does the hexane pump keep failing?",
    "kenapa pompa hexane bocor?",
    "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?",
    "EA-5601 tripped, can I restart it?",
    "what is the warranty period of GA-1201A?",
]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # CORS preflight
        self._send(204, {})

    def do_GET(self) -> None:
        u = urlparse(self.path)
        if u.path == "/health":
            return self._send(200, {"ok": True, "retrieval": ENGINE.R.mode,
                                    "llm_summary": llm_available(),
                                    "pilot_assets": ["GA-1201A", "EA-5601"],
                                    "passages": len(ENGINE.R.P)})
        if u.path == "/ask":
            q = (parse_qs(u.query).get("q") or [""])[0].strip()
            if not q:
                return self._send(400, {"error": "missing q"})
            return self._send(200, ENGINE.ask(q))
        if u.path == "/chains":
            return self._send(200, {"chains": [
                {k: c.get(k) for k in ("chain_id", "tag", "equipment", "root_mechanism", "wos",
                                       "first_seen", "last_seen", "span_days", "n_events",
                                       "total_downtime_h", "total_cost_idr", "confidence",
                                       "loss_of_containment", "detectable_on",
                                       "first_lesson_shared_on", "lesson_latency_days")}
                for c in ENGINE.chains]})
        if u.path == "/demo":
            return self._send(200, {"questions": DEMO})
        return self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/ask":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            q = (json.loads(self.rfile.read(n) or b"{}").get("query") or "").strip()
        except json.JSONDecodeError:
            return self._send(400, {"error": "invalid json"})
        if not q:
            return self._send(400, {"error": "missing query"})
        return self._send(200, ENGINE.ask(q))

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[cascade] " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"CASCADE API on http://0.0.0.0:{port}  (retrieval: {ENGINE.R.mode}, "
          f"LLM summary: {'on' if llm_available() else 'off'})")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
