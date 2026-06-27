"""Integration tests: reports, sessions, manual scoring, and auth enforcement."""
import json
import os
import urllib.error
import urllib.request

BASE = os.getenv("API_BASE", "http://localhost:5000")

ADMIN_LOGIN = {
    "userId": "admin",
    "password": "Admin@1234",
    "questionType": "Favorite color",
    "questionAnswer": "Red",
}


def post(path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status, json.loads(resp.read())


def get(path, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE}{path}", headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status, json.loads(resp.read())


def login():
    _, data = post("/api/login-security", ADMIN_LOGIN)
    assert data.get("success"), data
    return data


def test_auth_required():
    """Protected endpoints must reject requests without a token (401)."""
    try:
        get("/api/reports/inbound-calls-monthly")
        raise AssertionError("expected 401 without token")
    except urllib.error.HTTPError as exc:
        assert exc.code == 401, f"expected 401, got {exc.code}"
    print("auth enforcement OK (401 without token)")


def test_reports():
    token = login()["token"]
    endpoints = [
        "inbound-calls-monthly",
        "outbound-calls-weekly",
        "call-resolution-status",
        "agent-performance-metrics",
        "call-distribution-by-day",
        "agent-handling-summary",
        "call-volume-trends",
        "language-distribution",
    ]
    ok = 0
    for ep in endpoints:
        status, body = get(f"/api/reports/{ep}", token=token)
        assert status == 200 and body.get("success"), f"{ep} failed: {body}"
        ok += 1
    print(f"reports OK ({ok} endpoints, authenticated)")


def test_session_flow():
    data = login()
    token = data["token"]
    log_id = data["logId"]
    user_id = data.get("userId") or "9"

    status, check = post("/api/check-session", {"userId": user_id, "token": token})
    assert check.get("success"), check

    status, heartbeat = post(
        "/api/update-session-inactive-time",
        {"userId": user_id, "logId": log_id, "inactiveTime": "2026-06-12T12:00:00.000Z"},
    )
    assert heartbeat.get("success"), heartbeat

    status, logout = post(
        "/api/logout-track",
        {"userId": user_id, "logId": log_id, "token": token},
    )
    assert logout.get("success"), logout
    print("session flow OK")


def test_manual_scoring():
    data = login()
    token = data["token"]
    username = data["username"]
    filename = "1781287431523-MNDE6KLBIP66F9VF2IFRD9LLIC000008_2025-04-04_14-49-52-427F227E-10003653-00000001.mp3"

    payload = {
        "manualScores": {
            "Opening_Speech": 85,
            "Empathy": 90,
            "Query_Handling": 88,
            "Adherence_to_Protocol": 80,
            "Resolution_Assurance": 82,
            "Query_Resolution": 86,
            "Polite_Tone": 92,
            "Authentication_Verification": 78,
            "Escalation_Handling": 75,
            "Closing_Speech": 84,
            "Rude_Behavior": "No",
            "Call_Type": "Inquiry",
            "Lead_Classification": "Not a Lead",
            "Resolution_Status": "Resolved",
            "Feedback": "Automated QA test save",
            "Overall_Scoring": 84,
            "ManualScoredByUserID": username,
        }
    }
    status, save = post(f"/api/manual-scoring/{filename}", payload, token=token)
    assert save.get("success"), save

    _, details = get(f"/api/custom-scoring-details/{filename}", token=token)
    assert details.get("success"), details
    manual = details.get("manualScoring", {})
    assert manual.get("Opening Speech") == 85, manual
    assert manual.get("Feedback") == "Automated QA test save", manual
    print("manual scoring OK")


if __name__ == "__main__":
    test_auth_required()
    test_reports()
    test_session_flow()
    test_manual_scoring()
    print("All integration tests passed.")
