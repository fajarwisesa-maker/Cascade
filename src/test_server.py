"""Safe API metadata and fingerprint invariants."""
from __future__ import annotations

import os
import re
import unittest
from unittest.mock import patch

import server


class ServerContractTests(unittest.TestCase):
    def test_answer_has_commit_and_canonical_fingerprint(self) -> None:
        with patch.dict(os.environ, {"CASCADE_LLM_PROVIDER": "off"}, clear=False):
            answer = server.answer("why does the hexane pump keep failing?")
        self.assertEqual(answer["engine_commit"], "0fbef8b")
        self.assertRegex(answer["data_fingerprint"], r"^[0-9a-f]{64}$")
        self.assertRegex(answer["answer_fingerprint"], r"^[0-9a-f]{64}$")
        self.assertEqual(answer["summary"]["status"], "unavailable")
        self.assertEqual(answer["summary"]["reason"], "provider_off")
        self.assertEqual(answer["summary"]["engine_commit"], answer["engine_commit"])
        self.assertEqual(answer["summary"]["data_fingerprint"], answer["data_fingerprint"])
        self.assertEqual(answer["summary"]["answer_fingerprint"], answer["answer_fingerprint"])

    def test_summary_and_latency_do_not_change_fingerprint(self) -> None:
        answer = server.ENGINE.ask("EA-5601 tripped, can I restart it?")
        expected = server.answer_fingerprint(answer)
        answer["latency_ms"] = 999999
        answer["summary"] = {"status": "accepted", "selected": []}
        self.assertEqual(server.answer_fingerprint(answer), expected)

    def test_server_source_has_no_wildcard_cors(self) -> None:
        source = server.Path(server.__file__).read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"Access-Control-Allow-Origin[^\n]+['\"]\*", source))


if __name__ == "__main__":
    unittest.main()
