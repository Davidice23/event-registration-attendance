"""Read-only health, database readiness, UI and optional session smoke checks.

Usage: python3 deploy/smoke_test.py SERVICE_URL

Optional login test uses SMOKE_EMAIL and SMOKE_PASSWORD (both or neither). It
uses the lowest-privilege dedicated test account, cookies, and exact same-origin
Origin headers; it never prints credentials or response bodies.
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request


class SmokeCheckError(RuntimeError):
    """A safe-to-print smoke-check failure with no response or secret data."""


def request(base, path, data=None, cookies=None):
    headers = {"Accept": "application/json, text/html;q=0.9"}
    if data is not None:
        headers["Content-Type"] = "application/json"
        headers["Origin"] = base
    req = urllib.request.Request(
        base + path,
        headers=headers,
        data=json.dumps(data).encode("utf-8") if data is not None else None,
        method="POST" if data is not None else "GET",
    )
    if cookies is not None:
        cookies.add_cookie_header(req)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if cookies is not None:
                cookies.extract_cookies(response, req)
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        # Return only status/body to the caller; never display response text.
        if cookies is not None:
            cookies.extract_cookies(error, req)
        return error.code, error.read()


def parse_json(body, path):
    try:
        return json.loads(body)
    except (TypeError, ValueError):
        raise SmokeCheckError("Invalid JSON response: " + path) from None


def json_status(body, path, expected):
    payload = parse_json(body, path)
    return (
        isinstance(payload, dict)
        and isinstance(payload.get("data"), dict)
        and payload["data"].get("status") == expected
    )


def health_status(body, expected_commit_sha):
    payload = parse_json(body, "/api/health")
    data = payload.get("data") if isinstance(payload, dict) else None
    return (
        isinstance(data, dict)
        and data.get("status") == "ok"
        and (not expected_commit_sha or data.get("commitSha") == expected_commit_sha)
    )


def retry_check(base, path, predicate):
    for attempt in range(5):
        try:
            status, body = request(base, path)
            if status == 200 and predicate(body):
                print("PASS " + path)
                return
        except (OSError, TimeoutError, urllib.error.URLError, SmokeCheckError):
            pass
        if attempt < 4:
            time.sleep(3)
    raise SmokeCheckError("Smoke check failed: " + path)


def check(base):
    email = os.getenv("SMOKE_EMAIL", "")
    password = os.getenv("SMOKE_PASSWORD", "")
    expected_commit_sha = os.getenv("EXPECTED_COMMIT_SHA", "")
    if bool(email) != bool(password):
        raise SmokeCheckError("Set both SMOKE_EMAIL and SMOKE_PASSWORD, or neither.")

    retry_check(
        base,
        "/api/health",
        lambda body: health_status(body, expected_commit_sha),
    )
    retry_check(
        base,
        "/api/ready",
        lambda body: json_status(body, "/api/ready", "ready"),
    )
    retry_check(base, "/", lambda body: b"<html" in body.lower() and b"id=\"root\"" in body.lower())
    retry_check(base, "/events", lambda body: b"<html" in body.lower() and b"id=\"root\"" in body.lower())

    if not email:
        print("SKIP login: optional smoke credentials are not configured")
        return

    cookies = http.cookiejar.CookieJar()
    try:
        status, body = request(
            base, "/api/auth/login", {"email": email, "password": password}, cookies
        )
        login = parse_json(body, "/api/auth/login")
        user = login.get("data") if status == 200 and isinstance(login, dict) else None
        if not isinstance(user, dict) or not user.get("id") or user.get("role") not in {"ORGANIZER", "PARTICIPANT"}:
            raise SmokeCheckError("Login smoke check failed.")

        status, body = request(base, "/api/auth/me", cookies=cookies)
        current = parse_json(body, "/api/auth/me") if status == 200 else {}
        current_user = current.get("data") if isinstance(current, dict) else None
        if not isinstance(current_user, dict) or current_user.get("id") != user["id"]:
            raise SmokeCheckError("Authenticated profile smoke check failed.")
        print("PASS login and authenticated /api/auth/me")

        status, _ = request(base, "/api/auth/logout", {}, cookies)
        if status != 204:
            raise SmokeCheckError("Logout smoke check failed.")
        status, _ = request(base, "/api/auth/me", cookies=cookies)
        if status != 401:
            raise SmokeCheckError("Session invalidation smoke check failed.")
        print("PASS logout and session invalidation")
    except (OSError, TimeoutError, urllib.error.URLError):
        raise SmokeCheckError("Login smoke check could not reach the service.") from None
    finally:
        # Best effort logout in case an earlier authenticated assertion failed.
        try:
            request(base, "/api/auth/logout", {}, cookies)
        except (OSError, TimeoutError, urllib.error.URLError):
            pass


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or not args[0].startswith("https://"):
        raise SmokeCheckError("Usage: python3 deploy/smoke_test.py https://SERVICE_URL")
    check(args[0].rstrip("/"))


if __name__ == "__main__":
    try:
        main()
    except SmokeCheckError as error:
        print("ERROR: " + str(error), file=sys.stderr)
        sys.exit(1)
