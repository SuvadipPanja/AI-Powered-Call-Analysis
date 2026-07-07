"""Tests for lead classification reconciliation with intelligence."""

from intelligence_worker import reconcile_lead_classification


def test_not_loan_forces_not_a_lead():
    scores = {
        "Lead_Classification": "Warm Lead",
        "Loan_Is_Loan_Call": "No",
        "Loan_Type": "None",
        "Loan_Interest": "None",
        "Loan_Success_Probability": 0,
    }
    out = reconcile_lead_classification(scores)
    assert out["Lead_Classification"] == "Not a Lead"


def test_loan_high_interest_hot():
    scores = {
        "Lead_Classification": "Not a Lead",
        "Loan_Is_Loan_Call": "Yes",
        "Loan_Interest": "High",
        "Loan_Success_Probability": 80,
    }
    out = reconcile_lead_classification(scores)
    assert out["Lead_Classification"] == "Hot Lead"


def test_loan_low_interest_cold():
    scores = {
        "Lead_Classification": "Warm Lead",
        "Loan_Is_Loan_Call": "Yes",
        "Loan_Interest": "Low",
        "Loan_Success_Probability": 15,
    }
    out = reconcile_lead_classification(scores)
    assert out["Lead_Classification"] == "Cold Lead"


def test_loan_medium_warm():
    scores = {
        "Lead_Classification": "Hot Lead",
        "Loan_Is_Loan_Call": "Yes",
        "Loan_Interest": "Medium",
        "Loan_Success_Probability": 50,
    }
    out = reconcile_lead_classification(scores)
    assert out["Lead_Classification"] == "Warm Lead"
