import sys
from pathlib import Path

from fastapi.testclient import TestClient

# Ensure backend directory is on sys.path so backend package-local imports resolve.
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from main import app
from services import salesforce


def test_lead_capture_allows_blank_email_and_pushes_to_salesforce(monkeypatch):
    client = TestClient(app)

    monkeypatch.setattr(salesforce.cfg, "SF_OID", "00DFAKEOID")

    def fake_push_to_salesforce(lead):
        assert lead["email"] == ""
        assert lead["first_name"] == "Jane"
        assert lead["last_name"] == "Doe"
        return True, 200, "OK", ""

    monkeypatch.setattr(salesforce, "push_to_salesforce", fake_push_to_salesforce)

    payload = {
        "name": "Jane Doe",
        "email": "",
        "company": "Individual Physicians",
        "lead_source": "Clinical Trial",
        "physician_name": "Jane Doe",
        "npi": "1234567890",
        "npi_number": "1234567890",
        "auto": False,
    }

    response = client.post("/api/leads", json=payload)
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["salesforce_status"] == "success"
    assert body["salesforce_message"] == ""
    assert body["error"] is None
