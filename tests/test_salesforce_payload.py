from backend.services.salesforce import _build_salesforce_payload


def test_build_salesforce_payload_uses_configured_fields() -> None:
    lead = {
        "first_name": "Jane",
        "last_name": "Doe",
        "email": "jane@example.com",
        "phone": "1234567890",
        "company": "Acme",
        "title": "Cardiologist",
        "lead_source": "Clinical Trial",
        "npi": "1234567890",
        "npi_number": "1234567890",
        "specialization": "Cardiology",
        "gender_identity": "Female",
        "nct_id": "NCT123",
        "site": "Main Campus",
        "message": "Hello",
        "search_context": {"address": "Boston", "descriptions": ["Cardiology"], "total_results": 3},
    }

    payload = _build_salesforce_payload(lead, oid="oid-123", ret_url="https://example.com")

    assert payload["first_name"] == "Jane"
    assert payload["last_name"] == "Doe"
    assert payload["email"] == "jane@example.com"
    assert payload["GenderIdentity__c"] == "Female"
    assert payload["Gender_Identity__c"] == "Female"
    assert payload["Gender"] == "Female"
    assert payload["Specialization__c"] == "Cardiology"
    assert payload["NPI_Number__c"] == "1234567890"
    assert payload["oid"] == "oid-123"
    assert payload["retURL"] == "https://example.com"


def test_build_salesforce_payload_allows_blank_email() -> None:
    lead = {
        "first_name": "Jane",
        "last_name": "Doe",
        "email": "",
        "company": "Acme",
        "title": "Cardiologist",
        "lead_source": "Clinical Trial",
        "npi": "1234567890",
        "npi_number": "1234567890",
        "specialization": "Cardiology",
        "gender_identity": "Female",
        "nct_id": "NCT123",
        "site": "Main Campus",
        "message": "Hello",
    }

    payload = _build_salesforce_payload(lead, oid="oid-123", ret_url="https://example.com")

    assert payload["email"] == ""
    assert payload["GenderIdentity"] == "Female"
    assert payload["GenderIdentity__c"] == "Female"
    assert payload["Gender_Identity__c"] == "Female"
    assert payload["Gender"] == "Female"


def test_build_salesforce_payload_allows_blank_email_and_maps_gender_fields() -> None:
    lead = {
        "first_name": "Jane",
        "last_name": "Doe",
        "email": "",
        "company": "Acme",
        "title": "Cardiologist",
        "lead_source": "Clinical Trial",
        "npi": "1234567890",
        "npi_number": "1234567890",
        "specialization": "Cardiology",
        "gender_identity": "Female",
        "nct_id": "NCT123",
        "site": "Main Campus",
        "message": "Hello",
    }

    payload = _build_salesforce_payload(
        lead,
        oid="oid-123",
        ret_url="https://example.com",
        debug_email="debug@example.com",
    )

    assert payload["email"] == ""
    assert payload["GenderIdentity"] == "Female"
    assert payload["GenderIdentity__c"] == "Female"
