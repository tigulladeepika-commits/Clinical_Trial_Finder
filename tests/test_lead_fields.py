from backend.api.leads import LeadRequest


def test_lead_request_accepts_extended_salesforce_fields() -> None:
    body = LeadRequest(
        name="Jane Doe",
        email="jane@example.com",
        specialization="Cardiology",
        gender_identity="Female",
        npi_number="1234567890",
    )

    assert body.specialization == "Cardiology"
    assert body.gender_identity == "Female"
    assert body.npi_number == "1234567890"
