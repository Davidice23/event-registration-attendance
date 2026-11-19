"""Offline tests for deploy/smoke_test.py; no network requests are made."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "smoke", Path(__file__).parents[1] / "smoke_test.py"
)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeTests(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=True)
    def test_public_health_readiness_and_spa_checks_pass_without_credentials(self):
        responses = {
            "/api/health": (200, b'{"data":{"status":"ok"}}'),
            "/api/ready": (200, b'{"data":{"status":"ready"}}'),
            "/": (200, b'<!doctype html><html><div id="root"></div></html>'),
            "/events": (200, b'<!doctype html><html><div id="root"></div></html>'),
        }
        with patch.object(smoke, "request", side_effect=lambda _base, path, **_kw: responses[path]) as req:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                smoke.check("https://service.example.test")
        self.assertEqual(req.call_count, 4)
        self.assertIn("PASS /api/ready", output.getvalue())
        self.assertIn("SKIP login", output.getvalue())

    @patch.dict("os.environ", {}, clear=True)
    def test_not_ready_database_fails(self):
        responses = {
            "/api/health": (200, b'{"data":{"status":"ok"}}'),
            "/api/ready": (503, b'{"error":{"code":"TEMPORARILY_UNAVAILABLE"}}'),
        }
        with patch.object(smoke, "request", side_effect=lambda _base, path, **_kw: responses[path]), \
             patch.object(smoke.time, "sleep"):
            with self.assertRaisesRegex(smoke.SmokeCheckError, "/api/ready"):
                smoke.check("https://service.example.test")

    @patch.dict("os.environ", {"SMOKE_EMAIL": "smoke@example.test"}, clear=True)
    def test_partial_login_configuration_fails_without_network(self):
        with patch.object(smoke, "request") as req:
            with self.assertRaisesRegex(smoke.SmokeCheckError, "Set both"):
                smoke.check("https://service.example.test")
            req.assert_not_called()

    @patch.dict(
        "os.environ",
        {"SMOKE_EMAIL": "smoke@example.test", "SMOKE_PASSWORD": "never-print-this"},
        clear=True,
    )
    def test_optional_login_uses_cookie_session_and_verifies_logout(self):
        responses = {
            "/api/health": (200, b'{"data":{"status":"ok"}}'),
            "/api/ready": (200, b'{"data":{"status":"ready"}}'),
            "/": (200, b'<!doctype html><html><div id="root"></div></html>'),
            "/events": (200, b'<!doctype html><html><div id="root"></div></html>'),
            "/api/auth/login": (200, b'{"data":{"id":"u-1","role":"PARTICIPANT"}}'),
            "/api/auth/me": (200, b'{"data":{"id":"u-1","role":"PARTICIPANT"}}'),
            "/api/auth/logout": (204, b""),
        }
        calls = []

        def respond(_base, path, data=None, cookies=None):
            calls.append((path, data, cookies))
            if path == "/api/auth/me" and len([c for c in calls if c[0] == path]) == 2:
                return 401, b'{"error":{"code":"UNAUTHENTICATED"}}'
            return responses[path]

        with patch.object(smoke, "request", side_effect=respond):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                smoke.check("https://service.example.test")
        auth_calls = [c for c in calls if c[0].startswith("/api/auth/")]
        self.assertEqual([c[0] for c in auth_calls], [
            "/api/auth/login", "/api/auth/me", "/api/auth/logout",
            "/api/auth/me", "/api/auth/logout",
        ])
        self.assertIsNotNone(auth_calls[0][2])
        self.assertIn("PASS logout and session invalidation", output.getvalue())
        self.assertNotIn("never-print-this", output.getvalue())

    def test_requires_https_service_url(self):
        with self.assertRaisesRegex(smoke.SmokeCheckError, "Usage"):
            smoke.main(["http://service.example.test"])


if __name__ == "__main__":
    unittest.main()
