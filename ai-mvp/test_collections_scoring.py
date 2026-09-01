"""Unit tests for collections AQM scoring math + deterministic detectors.

Runs without a live LLM or DB. Run with pytest OR directly:
    python test_collections_scoring.py
"""

from __future__ import annotations

import collections_scoring as cs

RUBRIC = [
    {"key": "Self Introduction", "weight": 3, "threshold": 100, "group": "Compliance", "naEligible": True},
    {"key": "Recording Disclaimer", "weight": 3, "threshold": 100, "group": "Compliance", "naEligible": True},
    {"key": "RPC Verification", "weight": 4, "threshold": 100, "group": "Compliance", "isFatal": True, "naEligible": True},
    {"key": "Sentiment Analysis", "weight": 5, "threshold": 100, "group": "Customer Experience"},
    {"key": "Politeness and Empathy", "weight": 5, "threshold": 100, "group": "Customer Experience"},
    {"key": "PTP Success Rate", "weight": 15, "threshold": 100, "group": "Collections Effectiveness", "naEligible": True},
    {"key": "Payment Confirmation", "weight": 15, "threshold": 100, "group": "Collections Effectiveness", "naEligible": True},
    {"key": "Negotiation Quality", "weight": 10, "threshold": 100, "group": "Collections Effectiveness", "naEligible": True},
    {"key": "Reason for Delay", "weight": 10, "threshold": 100, "group": "Collections Effectiveness", "naEligible": True},
    {"key": "Agent Tone and Clarity", "weight": 3, "threshold": 100, "group": "Soft Skills"},
    {"key": "Rude and Unprofessional", "weight": 5, "threshold": 100, "group": "Soft Skills", "isFatal": True},
    {"key": "Telephone Etiquette", "weight": 2, "threshold": 100, "group": "Soft Skills"},
    {"key": "Unusual Patterns", "weight": 10, "threshold": 100, "group": "Risk and Fraud"},
    {"key": "Blank Documentation", "weight": 10, "threshold": 100, "group": "Documentation", "naEligible": True},
]


def _all(status="Pass", score=100.0):
    return {d["key"]: {"score": score, "status": status} for d in RUBRIC}


def test_dim_status():
    assert cs.dim_status(80, 60, False) == "Pass"
    assert cs.dim_status(40, 60, False) == "Fail"
    assert cs.dim_status(None, 60, True) == "NA"
    assert cs.dim_status(None, 60, False) == "Fail"


def test_all_pass_is_100():
    out = cs.compute_weighted_overall(_all("Pass", 100.0), RUBRIC)
    assert out["overall"] == 100.0
    assert out["redAlert"] == "No"
    assert out["fatalTriggered"] == "No"
    # payload keyed by DB column suffix
    assert "RPC_Verification" in out["dimensions"]


def test_na_renormalises():
    dims = _all("Pass", 100.0)
    dims["Reason for Delay"] = {"score": None, "status": "NA"}
    dims["Blank Documentation"] = {"score": None, "status": "NA"}
    out = cs.compute_weighted_overall(dims, RUBRIC)
    # remaining enabled weight = 80, all pass -> still 100 after re-normalisation
    assert out["overall"] == 100.0
    assert out["dimensions"]["Reason_For_Delay"]["status"] == "NA"
    assert out["dimensions"]["Reason_For_Delay"]["score"] is None


def test_rude_fail_is_red_alert_zero():
    dims = _all("Pass", 100.0)
    dims["Rude and Unprofessional"] = {"score": 0.0, "status": "Fail"}
    out = cs.compute_weighted_overall(dims, RUBRIC)
    assert out["overall"] == 0.0
    assert out["redAlert"] == "Yes"
    assert out["fatalTriggered"] == "Yes"


from contextlib import contextmanager


@contextmanager
def location_taboo_lexicon():
    """Inject the ICICI location-collision words. Default bank_config has no 'police'."""
    import bank_config
    from bank_config import BankConfig, invalidate_bank_config_cache

    prev = bank_config._cache.get("config")
    prev_at = bank_config._cache.get("loaded_at")
    cfg = BankConfig(
        bank_name="ICIC Home Finance Company",
        taboo_words=[
            {
                "word": "police",
                "language": "Any",
                "severity": "high",
                "appliesTo": "agent",
                "category": "compliance",
            },
            {
                "word": "jail",
                "language": "English",
                "severity": "high",
                "appliesTo": "agent",
                "category": "compliance",
            },
            {
                "word": "arrest",
                "language": "English",
                "severity": "high",
                "appliesTo": "agent",
                "category": "compliance",
            },
            {
                "word": "Madarchod",
                "language": "Hindi",
                "severity": "high",
                "appliesTo": "agent",
                "category": "rude",
            },
            {"word": "पुलिस", "language": "Any", "severity": "high", "appliesTo": "agent", "category": "compliance"},
            {"word": "पोलिस", "language": "Any", "severity": "high", "appliesTo": "agent", "category": "compliance"},
        ],
    )
    invalidate_bank_config_cache()
    bank_config._cache["config"] = cfg
    bank_config._cache["loaded_at"] = 10**12
    try:
        yield cfg
    finally:
        bank_config._cache["config"] = prev
        bank_config._cache["loaded_at"] = prev_at or 0.0


# Audio_063 (user-supplied original + the English line that zeroed the call).
THANESCRIPT_ORIGINAL = (
    "339.0 - 343.0 (Agent): ठीक आहे? किंवा ठाण्यामध्ये branch पण आहे. आहेच home finance चे.\n"
    "343.0 - 344.0 (Customer): उभे आहे?\n"
    "344.0 - 345.0 (Agent): थानामध्ये\n"
    "345.0 - 347.0 (Customer): okay ठीक आहे चालेल ना.\n"
    "347.0 - 352.0 (Agent): ठीक आहे. मी details update करतो system मध्ये ठीक आहे.\n"
)
THANESCRIPT_ENGLISH_BUG = (
    "339.0 - 343.0 (Agent): Alright? Or there is also a branch in Thane. There is a Home Finance one.\n"
    "343.0 - 344.0 (Customer): Are you there?\n"
    "344.0 - 345.0 (Agent): In the police station.\n"
    "345.0 - 347.0 (Customer): Okay, it's fine.\n"
    "347.0 - 352.0 (Agent): Alright. I will update the details in the system.\n"
)
THANESCRIPT_ENGLISH_FIXED = (
    "339.0 - 343.0 (Agent): Alright? Or there is also a Home Finance branch in Thane.\n"
    "344.0 - 345.0 (Agent): In Thane.\n"
)


def test_thane_branch_original_is_not_foul():
    with location_taboo_lexicon():
        out = cs.detect_foul(THANESCRIPT_ORIGINAL, THANESCRIPT_ORIGINAL, "Marathi")
    assert out["violation"] == "No", out
    assert out["agentHits"] == []


def test_thane_branch_english_police_station_is_not_foul():
    """Prod path: original is Thane+branch; English invented 'police station'."""
    with location_taboo_lexicon():
        out = cs.detect_foul(THANESCRIPT_ORIGINAL, THANESCRIPT_ENGLISH_BUG, "Marathi")
    assert out["violation"] == "No", out
    assert out["agentHits"] == []


def test_english_only_police_station_location_is_not_foul():
    with location_taboo_lexicon():
        out = cs.detect_foul(THANESCRIPT_ENGLISH_BUG, THANESCRIPT_ENGLISH_BUG, "English")
    assert out["violation"] == "No", out


def test_corrected_thane_english_is_not_foul():
    with location_taboo_lexicon():
        out = cs.detect_foul(THANESCRIPT_ORIGINAL, THANESCRIPT_ENGLISH_FIXED, "Marathi")
    assert out["violation"] == "No", out


def test_hindi_thane_branch_mistranslation_is_not_foul():
    original = (
        "10.0 - 14.0 (Agent): ठीक है, ठाणे में हमारी होम फाइनेंस ब्रांच भी है।\n"
        "14.0 - 16.0 (Agent): थाने में।\n"
    )
    english = (
        "10.0 - 14.0 (Agent): Alright, we also have a Home Finance branch in Thane.\n"
        "14.0 - 16.0 (Agent): In the police station.\n"
    )
    with location_taboo_lexicon():
        out = cs.detect_foul(original, english, "Hindi")
    assert out["violation"] == "No", out


def test_bengali_thana_branch_mistranslation_is_not_foul():
    original = (
        "10.0 - 14.0 (Agent): ঠিক আছে, থানেতে আমাদের হোম ফাইন্যান্স শাখাও আছে।\n"
    )
    english = (
        "10.0 - 14.0 (Agent): Alright, we also have a Home Finance branch in the police station.\n"
    )
    with location_taboo_lexicon():
        out = cs.detect_foul(original, english, "Bengali")
    assert out["violation"] == "No", out


def test_jail_road_landmark_is_not_foul():
    original = (
        "20.0 - 24.0 (Agent): हमारी ब्रांच जेल रोड पर है, वहीं जाकर payment कर सकते हैं।\n"
    )
    english = (
        "20.0 - 24.0 (Agent): Our branch is on jail road, you can go there and make the payment.\n"
    )
    with location_taboo_lexicon():
        out = cs.detect_foul(original, english, "Hindi")
    assert out["violation"] == "No", out


def test_english_invented_threat_verbs_cannot_fatal_thane():
    """Translator must not be able to escalate Thane into 'I will send the police'."""
    english = (
        "339.0 - 343.0 (Agent): Or go to the police station, I will send the police.\n"
        "344.0 - 345.0 (Agent): In the police station.\n"
    )
    with location_taboo_lexicon():
        out = cs.detect_foul(THANESCRIPT_ORIGINAL, english, "Marathi")
    assert out["violation"] == "No", out


def test_llm_cannot_keep_police_fatal_on_thane_branch():
    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "No", "genuineness": "Not Applicable", "propensity": "Low"},
        "fraud": {},
        "ztp": {"violation": "Yes", "categories": ["Threatening language"],
                "evidence": "In the police station."},
        "summary": "Agent used rude/abusive/threatening language and mentioned the police.",
        "feedback": "Agent used prohibited phrase(s): police — review required.",
        "disposition": "No Promise-Call back",
        "campaign": "PDM",
    }
    # THANESCRIPT_* is a mid-call fragment. Prefix a real opening so deterministic
    # RPC/intro do not fatal the call on their own — this test is about the LLM
    # police ZTP, not a missing script start.
    opening_orig = (
        "0.0 - 4.0 (Agent): namaste, mera naam Rahul hai, main ICIC Home Finance se bol raha hoon.\n"
        "4.0 - 6.0 (Agent): yeh call quality and training ke liye record ki ja rahi hai.\n"
        "6.0 - 8.0 (Agent): kya main Lala Ram ji se baat kar raha hoon?\n"
        "8.0 - 9.0 (Customer): haan ji.\n"
    )
    opening_en = (
        "0.0 - 4.0 (Agent): Hello, my name is Rahul, I am calling from ICIC Home Finance.\n"
        "4.0 - 6.0 (Agent): This call is being recorded for quality and training.\n"
        "6.0 - 8.0 (Agent): Am I speaking to Lala Ram?\n"
        "8.0 - 9.0 (Customer): Yes.\n"
    )
    with location_taboo_lexicon():
        scores = cs.build_collections_payload(
            parsed, RUBRIC,
            opening_orig + THANESCRIPT_ORIGINAL,
            opening_en + THANESCRIPT_ENGLISH_BUG,
            "Marathi",
            org_name="ICIC Home Finance Company",
        )
    coll = scores["Collections"]
    assert coll["redAlert"] == "No"
    assert coll["ztpViolation"] == "No"
    assert coll["fatalTriggered"] == "No"
    assert coll["dimensions"]["Rude_Unprofessional"]["status"] == "Pass"
    assert "police" not in " ".join(coll["ztpCategories"]).lower()
    assert "RED ALERT" not in (scores.get("Feedback") or "").upper()
    assert "police" not in (scores.get("Feedback") or "").lower()
    assert "police" not in (scores.get("Summary") or "").lower()


GPAY_LOAN_ORIGINAL = (
    "0.0 - 4.0 (Agent): namaste, mera naam Rahul hai, main ICIC Home Finance se bol raha hoon. "
    "Yeh call quality and training ke liye record ho rahi hai. Am I speaking to Abdul Shahid?\n"
    "4.0 - 5.0 (Customer): बोलिए ना\n"
    "5.0 - 12.0 (Agent): Payment nahi bhara hai 26349 rupees ka.\n"
    "12.0 - 16.0 (Customer): He didn't go to the bank, you send me the link. "
    "हम लोग गूगल पे या पेटीएम के थ्रू भर सकते हैं लोन अकाउंट नंबर डालकर\n"
    "16.0 - 20.0 (Agent): I'm giving you the loan number. You fill it up. "
    "ICICI Home Loan ke message me link aaya hua hai.\n"
    "20.0 - 22.0 (Customer): I can't fill it. Okay, I'll do it.\n"
    "22.0 - 25.0 (Agent): Now open the GPay. I'll take two minutes.\n"
    "25.0 - 28.0 (Agent): GPay me Pay Anyone option aata hai. Loan number / UPI ID se amount daaliye.\n"
    "28.0 - 32.0 (Agent): ठीक है भेज रहा हूँ sir, official link bhej raha hoon.\n"
)


def test_official_gpay_loan_number_is_not_personal_channel():
    out = cs.detect_personal_channel_fraud(GPAY_LOAN_ORIGINAL)
    assert out["personalChannel"] == "No"
    assert out["redAlert"] is False
    assert out["unusualPattern"] == "No"


def test_llm_unusual_patterns_cannot_override_clean_gpay_walkthrough():
    """Audio_094: detector Clean; 14B used category Unusual Patterns + a real GPay quote."""
    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "Yes", "genuineness": "Genuine", "propensity": "High"},
        "fraud": {},
        "ztp": {
            "violation": "Yes",
            "categories": ["Unusual Patterns"],
            "evidence": (
                "Agent directed payment to non-official channels: "
                "'Now open the GPay. I'll take two minutes.'"
            ),
        },
        "summary": "Agent directed payment to non-official channels via GPay.",
        "feedback": "Do not ask the borrower to open GPay.",
        "disposition": "Promise to pay",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, GPAY_LOAN_ORIGINAL, GPAY_LOAN_ORIGINAL, "Hindi",
        org_name="ICIC Home Finance Company",
    )
    coll = scores["Collections"]
    assert coll["fraud"]["personalChannel"] == "No"
    assert coll["redAlert"] == "No"
    assert coll["ztpViolation"] == "No"
    assert "unusual" not in " ".join(coll["ztpCategories"]).lower()
    assert coll["dimensions"]["Unusual_Patterns"]["status"] == "Pass"
    assert "RED ALERT" not in (scores.get("Feedback") or "").upper()
    assert "non-official" not in (scores.get("Summary") or "").lower()
    assert "gpay" not in (scores.get("Summary") or "").lower()


def test_llm_generic_category_cannot_smuggle_a_channel_quote():
    """Next-week backdoor: category Fraud / Policy / Risk + GPay evidence."""
    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {
            "violation": "Yes",
            "categories": ["Policy"],
            "evidence": "Now open the GPay. I'll take two minutes.",
        },
        "summary": "s",
        "feedback": "f",
        "disposition": "Call Back (Plain)",
        "campaign": "COLL",
    }
    t = (
        "0.0 - 4.0 (Agent): namaste, call record ho rahi hai, official app use kijiye.\n"
        "4.0 - 8.0 (Agent): Now open the GPay. I'll take two minutes.\n"
    )
    out = cs.build_collections_payload(parsed, RUBRIC, t, t, "Hindi", org_name="ICIC Home Finance")
    assert out["Collections"]["ztpViolation"] == "No"


def test_classify_llm_ztp_claim_routes_detector_owned_classes():
    assert cs.classify_llm_ztp_claim("Unusual Patterns", "Now open the GPay.") == "channel"
    assert cs.classify_llm_ztp_claim("Policy", "non-official channels: GPay") == "channel"
    assert cs.classify_llm_ztp_claim("Threatening language", "In the police station.") == "foul"
    assert cs.classify_llm_ztp_claim("Unauthorised waiver", "waive kar dunga personally") == "llm_only"
    assert cs.classify_llm_ztp_claim("Third party disclosure", "bata diya neighbour ko") == "llm_only"
    assert cs.classify_llm_ztp_claim("Mystery bucket", "hello how are you today sir") == "reject"


def test_llm_waiver_ztp_still_trusted_when_not_a_police_claim():
    parsed = {
        "dim_results": {d["key"]: {"score": 85.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {"violation": "Yes", "categories": ["Unauthorised waiver"],
                "evidence": "main aapka penalty charge waive kar dunga personally"},
        "summary": "s",
        "feedback": "f",
        "disposition": "Call Back (Plain)",
        "campaign": "COLL",
    }
    t = (
        "0.0 - 5.0 (Agent): namaste, call record ho rahi hai.\n"
        "5.0 - 9.0 (Agent): main aapka penalty charge waive kar dunga personally.\n"
    )
    out = cs.build_collections_payload(parsed, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance")
    coll = out["Collections"]
    assert coll["ztpViolation"] == "Yes"
    assert any("waiver" in c.lower() for c in coll["ztpCategories"])


def test_rpc_fatal_zeroes_complete_call():
    dims = _all("Pass", 100.0)
    dims["RPC Verification"] = {"score": 0.0, "status": "Fail"}
    out = cs.compute_weighted_overall(dims, RUBRIC)
    assert out["overall"] == 0.0
    assert out["fatalTriggered"] == "Yes"
    assert out["redAlert"] == "No"
    assert "fatal to the call" in out["fatalReason"]


def test_binary_contract_canonicalises_model_confidence_scores():
    dims = _all("Pass", 67.0)
    dims["Politeness and Empathy"] = {"score": 40.0, "status": "Fail"}
    out = cs.compute_weighted_overall(dims, RUBRIC)
    assert out["dimensions"]["Self_Introduction"]["score"] == 100.0
    assert out["dimensions"]["Politeness_Empathy"]["score"] == 0.0
    assert out["overall"] == 95.0


def test_personal_channel_fraud_detected():
    transcript = (
        "0.0 - 4.0 (Agent): Sir aap payment meri personal gpay number par bhej dijiye.\n"
        "4.0 - 6.0 (Customer): theek hai.\n"
    )
    out = cs.detect_personal_channel_fraud(transcript)
    assert out["personalChannel"] == "Yes"
    assert out["evidence"]


def test_no_fraud_on_clean_call():
    transcript = (
        "0.0 - 4.0 (Agent): Aap official app ya net banking se payment kar sakte hain.\n"
    )
    assert cs.detect_personal_channel_fraud(transcript)["personalChannel"] == "No"


def test_sentiment_trajectory_declining():
    transcript = (
        "0.0 - 2.0 (Customer): thank you, sure I understand.\n"
        "2.0 - 4.0 (Customer): ok fine.\n"
        "4.0 - 6.0 (Customer): this is a problem, I am angry and upset.\n"
        "6.0 - 8.0 (Customer): terrible, I refuse, this is a complaint.\n"
    )
    traj = cs.sentiment_trajectory(transcript, "Customer")
    assert traj["direction"] == "declining"
    assert traj["start"] > traj["end"]


def test_compressed_asr_timestamps_do_not_invent_rushing():
    # Long Hindi script packed into a short span used to yield 200+ wpm and Fail tone.
    t = (
        "0.0 - 2.0 (Agent): Good afternoon, my name is Anita from ICIC Home Finance.\n"
        "3.0 - 4.0 (Customer): Yes\n"
        "4.0 - 12.0 (Agent): This call is being recorded for quality and training. "
        "Your loan account last four digits are 3453, EMI date is the fifth, amount "
        "is fifteen thousand nine hundred eighty seven rupees, please confirm sir.\n"
        "13.0 - 14.0 (Customer): Okay\n"
    )
    ros = cs.rate_of_speech_and_dead_air(t)
    assert ros["wpm"] is not None and ros["wpm"] <= 200
    parsed = {
        "dim_results": {d["key"]: {"score": 20.0, "status": "Fail", "evidence": "rushed"} for d in RUBRIC},
        "ptp": {"present": "No"}, "fraud": {}, "ztp": {}, "summary": "s", "feedback": "f",
        "disposition": "No Promise-Call back", "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance Company"
    )
    assert scores["Collections"]["dimensions"]["Agent_Tone_Clarity"]["status"] == "Pass"


def test_dead_air_detected():
    transcript = (
        "0.0 - 2.0 (Agent): hello.\n"
        "2.0 - 3.0 (Customer): haan.\n"
        "9.0 - 11.0 (Agent): sorry for the wait.\n"  # 6s gap
    )
    ros = cs.rate_of_speech_and_dead_air(transcript)
    assert ros["deadAirCount"] == 1
    assert ros["deadAirMaxSec"] >= 3.0


def test_parse_collections_json():
    raw = (
        '{"dimensions": {"RPC Verification": {"score": 100, "status": "Pass"},'
        ' "PTP Success Rate": {"score": 70, "status": "Pass"}},'
        ' "ptp": {"present": "Yes", "amount": 5000},'
        ' "callType": "PTP", "summary": "ok", "feedback": "good"}'
    )
    parsed = cs.parse_collections_json(raw, RUBRIC)
    assert parsed["dim_results"]["RPC Verification"]["score"] == 100.0
    assert parsed["ptp"]["present"] == "Yes"
    assert parsed["callType"] == "PTP"
    # every rubric key present in dim_results
    assert set(parsed["dim_results"].keys()) == {d["key"] for d in RUBRIC}


def test_build_payload_fraud_fails_unusual_patterns():
    parsed = {
        "dim_results": {d["key"]: {"score": 100.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {},
        "summary": "s",
        "feedback": "f",
        "callType": "RPC",
    }
    transcript = "0.0 - 4.0 (Agent): mere personal account me paisa daal do.\n"
    scores = cs.build_collections_payload(parsed, RUBRIC, transcript, "", "Hindi")
    coll = scores["Collections"]
    assert coll["fraud"]["personalChannel"] == "Yes"
    assert coll["dimensions"]["Unusual_Patterns"]["status"] == "Fail"
    assert scores["Overall_Scoring"] < 100.0
    assert "Collections" in scores


def test_bare_payment_app_mentions_do_not_prove_personal_destination():
    # A wallet/app name is not proof that the destination belongs to the agent.
    # BRD fatality needs explicit personal ownership plus payment direction.
    for line in (
        "0.0 - 4.0 (Agent): aap google pay ya phone pe use karte ho, main karwa deta hu.\n",
        "0.0 - 4.0 (Agent): phonepe se payment kar dijiye sir.\n",
        "0.0 - 4.0 (Agent): paytm khol lijiye.\n",
    ):
        out = cs.detect_personal_channel_fraud(line)
        assert out["personalChannel"] == "No", line
        assert out["redAlert"] is False


def test_devanagari_payment_app_words_alone_are_clean():
    # Native ASR app words also need explicit personal ownership.
    line = "0.0 - 4.0 (Agent): अब गूगल पे फोन पे यूज करते हो क्या payment ke liye?\n"
    out = cs.detect_personal_channel_fraud(line)
    assert out["personalChannel"] == "No"


def test_official_channels_stay_clean_after_app_broadening():
    # Broadening for wallet apps must NOT flag legitimate official channels.
    for line in (
        "0.0 - 4.0 (Agent): Aap official app ya net banking se payment kar sakte hain.\n",
        "0.0 - 4.0 (Agent): company app se payment kar dijiye sir.\n",
        "0.0 - 4.0 (Agent): Official UPI id par payment kariye jo SMS me aaya hai.\n",
        "0.0 - 4.0 (Agent): Branch me jaakar cash jama kar dijiye.\n",
    ):
        assert cs.detect_personal_channel_fraud(line)["personalChannel"] == "No", line


def test_personal_channel_fraud_raises_ztp():
    parsed = {
        "dim_results": {d["key"]: {"score": 100.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {},
        "summary": "s",
        "feedback": "f",
        "callType": "RPC",
    }
    transcript = (
        "0.0 - 4.0 (Agent): payment meri personal UPI id par bhej dijiye.\n"
        "4.0 - 6.0 (Customer): haan sir.\n"
    )
    scores = cs.build_collections_payload(parsed, RUBRIC, transcript, "", "Hindi")
    coll = scores["Collections"]
    assert coll["fraud"]["personalChannel"] == "Yes"
    assert coll["dimensions"]["Unusual_Patterns"]["status"] == "Fail"
    # Personal-channel collection is a zero-tolerance breach, not just "unusual".
    assert coll["ztpViolation"] == "Yes"
    assert any("personal payment" in c.lower() for c in coll["ztpCategories"])


def test_personal_channel_payment_collection_is_red_alert():
    # Two signals — a consumer channel AND a real payment action — is a
    # zero-tolerance money-handling breach: red alert, overall zeroed.
    parsed = {
        "dim_results": {d["key"]: {"score": 100.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {},
        "summary": "s",
        "feedback": "f",
        "callType": "RPC",
    }
    transcript = (
        "0.0 - 4.0 (Agent): main apni personal UPI id message kar raha hu.\n"
        "4.0 - 8.0 (Agent): amount 3034 daaliye aur payment kar dijiye, screenshot bhej dena.\n"
        "8.0 - 10.0 (Customer): हाँ payment हो गया.\n"
    )
    scores = cs.build_collections_payload(parsed, RUBRIC, transcript, "", "Hindi")
    coll = scores["Collections"]
    assert coll["redAlert"] == "Yes"
    assert coll["overall"] == 0.0
    assert coll["fatalTriggered"] == "Yes"
    assert coll["ztpViolation"] == "Yes"
    assert scores["Feedback"].startswith("RED ALERT")


def test_lone_channel_mention_is_not_a_policy_flag_or_red_alert():
    # A bare app word is informational, not evidence of a private destination.
    out = cs.detect_personal_channel_fraud(
        "0.0 - 4.0 (Agent): गूगल पे फोन पे के बारे में पूछ रहा था.\n"
    )
    assert out["personalChannel"] == "No"
    assert out["unusualPattern"] == "No"
    assert out["redAlert"] is False


def test_long_call_judge_transcript_fits_context():
    # A 12-15 min bilingual call must never overflow the 8192-token window: the
    # judge transcript is hard-capped and the JSON output is bounded. Detectors
    # still run on the full transcript inside build_collections_payload.
    # Manual patch/restore (no pytest fixture) so the file's own __main__ runner
    # — used by the image build gate — can execute this test too.
    import prompts.collections as pc
    import scoring_worker as sw

    captured: dict[str, object] = {}

    def fake_system(bank_cfg):
        return "SYS"

    def fake_json_prompt(transcript, bank_cfg, rubric_dims):
        captured["transcript_len"] = len(transcript)
        return "PROMPT:" + transcript

    def fake_llm(prompt, system=None, *, json_mode=False, temperature=None, max_tokens=None):
        captured["prompt_len"] = len(prompt)
        captured["max_tokens"] = max_tokens
        return "{}"

    class _Cfg:
        bank_name = "ICIC Home Finance"

    huge = "\n".join(
        f"{i}.0 - {i + 1}.0 (Agent): यह एक लंबी कॉल है payment ke baare me baat kar rahe hain."
        for i in range(2500)
    )

    orig_sys = pc.collections_system_prompt
    orig_prompt = pc.collections_json_prompt
    orig_llm = sw.ollama_generate
    pc.collections_system_prompt = fake_system
    pc.collections_json_prompt = fake_json_prompt
    sw.ollama_generate = fake_llm
    try:
        out = cs.score_collections(
            "0.0 - 1.0 (Agent): hello",
            huge,
            "Hindi",
            rubric_dims=RUBRIC,
            bank_cfg=_Cfg(),
        )
    finally:
        pc.collections_system_prompt = orig_sys
        pc.collections_json_prompt = orig_prompt
        sw.ollama_generate = orig_llm

    assert captured["transcript_len"] <= cs._COLL_LLM_MAX_TRANSCRIPT_CHARS + 60
    assert captured["max_tokens"] == cs._COLL_LLM_MAX_OUTPUT_TOKENS
    assert "Collections" in out


def test_normalize_disposition():
    assert cs.normalize_disposition("confirm to ecs") == "Confirm TO ECS"
    assert cs.normalize_disposition("Promise To Pay") == "Promise to pay"
    assert cs.normalize_disposition("will not clear") == "Will not clear"
    assert cs.normalize_disposition("banana") == "Other"
    assert cs.normalize_disposition("") == ""


def test_derive_disposition_confirm_ecs():
    # Borrower on auto-debit agrees to maintain balance -> Confirm TO ECS.
    ptp = {"present": "Yes", "mode": "auto debit"}
    transcript = (
        "0.0 - 4.0 (Agent): due date ke ek din pehle account me balance maintain kar dijiye.\n"
        "4.0 - 6.0 (Customer): haan main kal rakh dunga.\n"
    )
    assert cs.derive_disposition("", ptp, {}, transcript) == "Confirm TO ECS"


def test_derive_disposition_trusts_valid_llm():
    assert cs.derive_disposition("Will not clear", {}, {}, "") == "Will not clear"


def test_derive_campaign_pdm_vs_coll():
    pre = "0.0 - 4.0 (Agent): due date se pehle balance maintain kar dijiye.\n"
    over = "0.0 - 4.0 (Agent): aapka EMI overdue hai, bakaya clear kariye.\n"
    assert cs.derive_campaign("", pre) == "PDM"
    assert cs.derive_campaign("", over) == "COLL"
    # Evidence wins over the model label: an overdue call is never a pre-due reminder.
    assert cs.derive_campaign("PDM", over) == "COLL"


def test_preventive_bounce_warning_is_pdm_not_coll():
    # Pre-due reminder that only warns the EMI must not bounce.
    t = (
        "0.0 - 6.0 (Agent): please maintain the balance in the account 1 day before the due date "
        "so that your EMI doesn't bounce.\n"
        "6.0 - 8.0 (Customer): ok I will keep it tomorrow.\n"
    )
    assert cs.derive_campaign("COLL", t) == "PDM"
    assert cs._has_delay_context(t) is False


def test_na_override_forces_documentation_and_rfd():
    # LLM invents mid scores for CRM-fed / no-delay dims; the builder must NA them.
    parsed = {
        "dim_results": {
            **{d["key"]: {"score": 100.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
            "Reason for Delay": {"score": 50.0, "status": "Fail", "evidence": "guessed"},
            "Blank Documentation": {"score": 50.0, "status": "Fail", "evidence": "guessed"},
        },
        "ptp": {"present": "Yes", "mode": "ECS"},
        "fraud": {}, "ztp": {}, "summary": "s", "feedback": "f",
        "disposition": "Confirm TO ECS", "campaign": "PDM",
    }
    # On-time reminder transcript with no delay cue; compliance steps present so
    # the deterministic criteria pass and only the NA re-normalisation is tested.
    transcript = (
        "0.0 - 4.0 (Agent): namaste, mera naam Rahul hai, main ICIC Home Finance se bol raha hoon.\n"
        "4.0 - 6.0 (Agent): yeh call quality and training ke liye record ki ja rahi hai.\n"
        "6.0 - 8.0 (Agent): kya main Lala Ram ji se baat kar raha hoon?\n"
        "8.0 - 9.0 (Customer): haan ji.\n"
            "9.0 - 13.0 (Agent): aapki EMI 15,987 rupees hai, due date se pehle account me balance maintain kariye.\n"
            "13.0 - 15.0 (Customer): haan theek hai, kal rakh dunga.\n"
            "15.0 - 19.0 (Agent): A 590 rupees bounce charge lagega; can you maintain the balance?\n"
            "19.0 - 21.0 (Customer): Yes, I will maintain it tomorrow.\n"
        )
    scores = cs.build_collections_payload(parsed, RUBRIC, transcript, "", "Hindi")
    coll = scores["Collections"]
    assert coll["dimensions"]["Blank_Documentation"]["status"] == "NA"
    assert coll["dimensions"]["Reason_For_Delay"]["status"] == "NA"
    # NA dims excluded -> remaining all Pass -> overall 100.
    assert scores["Overall_Scoring"] == 100.0
    assert coll["disposition"] == "Confirm TO ECS"
    assert coll["campaign"] == "PDM"
    assert scores["Call_Type"] == "Confirm TO ECS"


# ---------------------------------------------------------------------------
# Real ICIC HFC sample call (bounced EMI, borrower agrees to maintain balance so
# the ECS clears). The model previously scored this as "Call Back (Plain)" with
# no PTP and coached the agent to fix a disclaimer they had actually given.
# ---------------------------------------------------------------------------
ICIC_SAMPLE = (
    "5.0 - 11.0 (Agent): Hello Lala Ram ji, are you there? Lala Ram ji\n"
    "12.0 - 13.0 (Customer): Hello\n"
    "14.0 - 15.0 (Agent): Are you talking to Lala Ram?\n"
    "16.0 - 17.0 (Customer): Yes\n"
    "19.0 - 43.0 (Agent): Sir, this call is from ICICI Home Finance Company regarding quality "
    "and training. This is a recording of your home phone call. Sir, there was a bounce in the "
    "last payment and there is an update on the amount in your account.\n"
    "44.0 - 45.0 (Customer): Yeah\n"
    "46.0 - 48.0 (Agent): Yes, there is a challenge to maintain.\n"
    "49.0 - 51.0 (Customer): No, don't mess it up by evening\n"
    "56.0 - 60.0 (Agent): As I checked last time, the bounce occurred. What is the reason for the bounce?\n"
    "61.0 - 62.0 (Customer): Oh, it's too much company\n"
    "63.0 - 77.0 (Agent): Because sir, last time you mentioned that 1.5 percent penal charges are "
    "also applied monthly.\n"
    "79.0 - 102.0 (Agent): And as you had a bounce in April and a bounce in December, so 3 "
    "consecutive bounces occur, then your ACD gets activated and a notice also comes.\n"
    "103.0 - 104.0 (Customer): Yes\n"
    "119.0 - 122.0 (Agent): Alright, as you said, today you will maintain it. Tomorrow, you will "
    "check your account, and I will update it here.\n"
    "126.0 - 128.0 (Customer): Okay, fine, I will do it\n"
    "131.0 - 134.0 (Agent): Okay sir, have you downloaded the ICICI Housing Finance App?\n"
)


def test_icic_sample_disclaimer_detected():
    out = cs.detect_recording_disclaimer(ICIC_SAMPLE)
    assert out["present"] is True
    assert "quality" in out["evidence"].lower() or "recording" in out["evidence"].lower()


def test_icic_sample_self_intro_company_only_is_fail():
    out = cs.detect_self_introduction("ICIC Home Finance Company", ICIC_SAMPLE)
    assert out["companyGiven"] is True
    assert out["nameGiven"] is False


def test_self_intro_pass_needs_name_and_company():
    t = "0.0 - 5.0 (Agent): mera naam Rahul hai, main ICIC Home Finance se bol raha hoon.\n"
    out = cs.detect_self_introduction("ICIC Home Finance Company", t)
    assert out["nameGiven"] and out["companyGiven"]


def test_icic_sample_rpc_verified_on_second_ask():
    out = cs.detect_rpc_verification(ICIC_SAMPLE)
    assert out["verified"] is True
    assert out["asked"] is True


def test_icic_sample_delay_probe_asked_and_answered():
    out = cs.detect_delay_probe(ICIC_SAMPLE)
    assert out["asked"] is True
    assert out["answered"] is True


def test_icic_sample_commitment_is_ecs_for_today():
    out = cs.detect_commitment(ICIC_SAMPLE)
    assert out["present"] is True
    assert out["mode"] == "ECS"
    assert out["timing"].lower() == "today"
    assert out["agentReadBack"] is True


def test_vague_answer_is_not_a_commitment():
    t = (
        "0.0 - 4.0 (Agent): kab tak payment kar denge?\n"
        "4.0 - 7.0 (Customer): dekh lunga, baad me batata hoon.\n"
    )
    out = cs.detect_commitment(t)
    assert out["present"] is False
    assert out["vagueOnly"] is True


def test_reconcile_ptp_upgrades_missed_commitment():
    commitment = {
        "present": True,
        "mode": "ECS",
        "timing": "today",
        "amountConfirmed": True,
        "evidence": "maintain today",
    }
    ptp = cs.reconcile_ptp({"present": "No", "genuineness": "Not Applicable"}, commitment, ICIC_SAMPLE)
    assert ptp["present"] == "Yes"
    assert ptp["mode"] == "ECS"
    assert ptp["date"] == "today"
    # two bounces mentioned on the call -> commitment is doubtful, not genuine
    assert ptp["genuineness"] == "Doubtful"


def test_partial_or_conditional_payment_intent_is_not_promoted_to_ptp():
    transcript = (
        "0.0 - 6.0 (Customer): My bank account is blocked right now. "
        "When it is open again, I can make the payment.\n"
        "7.0 - 12.0 (Agent): Please try to pay today.\n"
    )
    commitment = cs.detect_commitment(transcript)
    conditional = cs.detect_conditional_payment_intent(transcript)
    ptp = cs.reconcile_ptp(
        {"present": "Yes", "genuineness": "Genuine", "propensity": "High"},
        commitment,
        transcript,
        conditional,
    )
    assert conditional["present"] is True
    assert cs.is_secured_ptp(commitment) is False
    assert ptp["present"] == "No"
    assert "conditional or partial willingness" in ptp["summary"].lower()
    assert cs.derive_disposition("Promise to pay", ptp, {}, transcript, commitment) == "No Promise-Call back"


def test_conditional_call_uses_grounded_summary_and_payment_confirmation_evidence():
    transcript = (
        "0.0 - 4.0 (Agent): This call is recorded. Your loan payment is overdue.\n"
        "4.0 - 10.0 (Customer): My account is blocked. When it is open again, I can make the payment.\n"
        "10.0 - 15.0 (Agent): Please try to make the payment today; two or three days cannot be given.\n"
        "15.0 - 19.0 (Customer): The bank said it should be active on Monday.\n"
        "19.0 - 23.0 (Agent): It will be ready soon. Okay.\n"
    )
    parsed = {
        "dim_results": {
            **{d["key"]: {"score": 80.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
            "PTP Success Rate": {"score": 0.0, "status": "Fail", "evidence": "no promise"},
            "Payment Confirmation": {
                "score": 0.0,
                "status": "Fail",
                "evidence": "Not found. Anchor: 'It will be ready soon. Okay.'",
            },
        },
        "ptp": {"present": "Yes", "genuineness": "Genuine", "propensity": "High"},
        "fraud": {},
        "ztp": {},
        "summary": "The borrower only acknowledged the discussion.",
        "feedback": (
            "Payment Confirmation: Not found. Anchor: 'It will be ready soon. Okay.'"
        ),
        "disposition": "Promise to pay",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, transcript, transcript, "Hindi", org_name="ICIC Home Finance"
    )
    coll = scores["Collections"]
    assert coll["ptp"]["present"] == "No"
    assert coll["ptp"]["amount"] is None
    assert coll["disposition"] == "No Promise-Call back"
    assert coll["dimensions"]["Payment_Confirmation"]["status"] == "Fail"
    assert "conditional or partial willingness" in scores["Feedback"].lower()
    assert "anchor:" not in scores["Feedback"].lower()
    assert "after the account obstacle was resolved" in scores["Summary"].lower()


def test_incomplete_commitment_does_not_beat_callback_label():
    commitment = cs.detect_commitment(ICIC_SAMPLE)
    got = cs.derive_disposition("Call Back (Plain)", {"present": "No"}, {}, ICIC_SAMPLE, commitment)
    assert cs.is_secured_ptp(commitment) is False
    assert got == "No Promise-Call back"


def test_complete_ptp_evidence_beats_callback_label():
    transcript = (
        "0.0 - 6.0 (Agent): Your EMI is 5,000 rupees. Can you pay tomorrow online?\n"
        "6.0 - 10.0 (Customer): Yes, I will pay tomorrow online.\n"
    )
    commitment = cs.detect_commitment(transcript)
    assert cs.is_secured_ptp(commitment) is True
    got = cs.derive_disposition(
        "Call Back (Plain)", {"present": "No"}, {}, transcript, commitment
    )
    assert got == "Promise to pay"


def test_disposition_rejects_unevidenced_ptp_label():
    # Model claims a PTP outcome with no commitment anywhere in the call.
    t = "0.0 - 4.0 (Agent): kab tak payment karenge?\n4.0 - 6.0 (Customer): dekh lunga.\n"
    got = cs.derive_disposition("Promise to pay", {"present": "No"}, {}, t, cs.detect_commitment(t))
    assert got == "No Promise-Call back"


def test_icic_sample_full_payload():
    parsed = {
        # What the model actually returned for this call.
        "dim_results": {
            **{d["key"]: {"score": 70.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
            "Self Introduction": {"score": 40.0, "status": "Fail", "evidence": "no intro"},
            "Recording Disclaimer": {"score": 30.0, "status": "Fail", "evidence": "missing"},
            "PTP Success Rate": {"score": 20.0, "status": "Fail", "evidence": "no ptp"},
        },
        "ptp": {"present": "No", "genuineness": "Doubtful", "propensity": "Low"},
        "fraud": {}, "ztp": {},
        "summary": "Agent called about a bounced payment.",
        "feedback": (
            "The agent needs to improve their introduction, recording disclaimer, and overall "
            "call structure. They should focus on securing a clear promise to pay."
        ),
        "disposition": "Call Back (Plain)",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, ICIC_SAMPLE, "", "Hindi", org_name="ICIC Home Finance Company"
    )
    coll = scores["Collections"]
    dims = coll["dimensions"]

    # Disclaimer was given in the call -> deterministic Pass.
    assert dims["Recording_Disclaimer"]["status"] == "Pass"
    # Company named but agent never gave their own name -> stays a Fail.
    assert dims["Self_Introduction"]["status"] == "Fail"
    # Right party confirmed on the second ask -> Pass, no fatal.
    assert dims["RPC_Verification"]["status"] == "Pass"
    assert coll["fatalTriggered"] == "No"
    # Agent probed the bounce reason.
    assert dims["Reason_For_Delay"]["status"] == "Pass"
    # Willingness and timing were captured, but no numeric amount was confirmed;
    # the strict BRD PTP bundle therefore remains incomplete.
    assert dims["PTP_Success_Rate"]["status"] == "Fail"
    assert coll["ptp"]["present"] == "No"
    assert coll["ptp"]["mode"] == ""
    assert coll["disposition"] == "No Promise-Call back"
    assert coll["campaign"] == "COLL"
    assert scores["Resolution_Status"] == "Follow-Up"
    # Coaching must not tell the agent to fix a disclaimer they gave.
    assert "disclaimer" not in scores["Feedback"].lower()
    assert "Self Introduction" in scores["Feedback"] or "introduc" in scores["Feedback"].lower()


# ---------------------------------------------------------------------------
# Sample call 2 - pre-due reminder (Rajendra Singh Gurjar). The agent verified
# the borrower by full name, gave greeting+name+company+disclaimer, confirmed
# amounts and dates, and the borrower committed to maintain balance. Nothing here
# is a compliance failure and there is no bounce, so "Reason for delay" is NA.
# ---------------------------------------------------------------------------
PREDUE_SAMPLE = (
    "2.0 - 3.0 (Customer): Hmm\n"
    "25.0 - 28.0 (Agent): I'm talking to Rajendra Singh Gurjar, can you hear me?\n"
    "29.0 - 30.0 (Customer): Yes\n"
    "32.0 - 59.0 (Agent): Good morning sir, this is Deepika speaking on behalf of ICIC Home "
    "Finance Company. This call is being recorded for internal quality training. Mr. Rajendra, "
    "the last 4 digits of your loan account are 2546. The one for the 5th date is 760 rupees, "
    "and that payment has been made sir.\n"
    "60.0 - 61.0 (Customer): Yes, it's done\n"
    "62.0 - 63.0 (Agent): Alright, the debit from the account has been done sir\n"
    "64.0 - 65.0 (Customer): Yes\n"
    "65.0 - 79.0 (Agent): Okay, and the 6784 rupees, 7133 and 5591. These 3 have a due date of "
    "the 10th sir. So, you have already maintained a balance in the account or you will maintain "
    "it 1 day before sir.\n"
    "80.0 - 82.0 (Customer): I'll keep it for tomorrow.\n"
    "83.0 - 89.0 (Agent): Okay, please maintain the balance in the account 1 day before the due "
    "date so that your EMI doesn't bounce.\n"
    "90.0 - 91.0 (Customer): Yes\n"
    "93.0 - 94.0 (Customer): I will do it, madam.\n"
    "95.0 - 101.0 (Agent): If the EMI bounces, a bounce charge of 590 rupees can be applied to "
    "all 3 accounts.\n"
    "102.0 - 103.0 (Customer): Okay\n"
    "104.0 - 109.0 (Agent): Okay sir, thank you for giving ICIC Home Finance Company a chance.\n"
)


def test_predue_sample_rpc_verified_from_statement_form():
    # "I'm talking to <first last>" is the common phrasing and must not be fatal.
    out = cs.detect_rpc_verification(PREDUE_SAMPLE)
    assert out["verified"] is True


def test_predue_sample_full_intro_passes():
    out = cs.detect_self_introduction("ICIC Home Finance Company", PREDUE_SAMPLE)
    assert out["greetingGiven"] and out["nameGiven"] and out["companyGiven"]


def test_predue_sample_payload():
    parsed = {
        "dim_results": {d["key"]: {"score": 85.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "Yes", "genuineness": "Genuine", "propensity": "High"},
        "fraud": {}, "ztp": {},
        "summary": "Agent reminded the borrower to maintain balance.",
        "feedback": "The agent did not confirm the borrower's identity. No coaching is needed as all dimensions were passed.",
        "disposition": "Confirm TO ECS",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, PREDUE_SAMPLE, "", "Hindi", org_name="ICIC Home Finance Company"
    )
    coll = scores["Collections"]
    dims = coll["dimensions"]
    assert dims["RPC_Verification"]["status"] == "Pass"
    assert coll["fatalTriggered"] == "No"
    assert dims["Self_Introduction"]["status"] == "Pass"
    # No bounce happened - preventive warnings do not make the delay probe applicable.
    assert dims["Reason_For_Delay"]["status"] == "NA"
    # Date + amount + mode + borrower commitment -> full PTP credit.
    assert dims["PTP_Success_Rate"]["score"] == 100.0
    assert coll["campaign"] == "PDM"
    assert coll["disposition"] == "Confirm TO ECS"
    # False claim about identity confirmation is dropped from the coaching text.
    assert "did not confirm the borrower" not in scores["Feedback"].lower()


# ---------------------------------------------------------------------------
# Sample call 3 - double-payment dispute (Raju). Agent verified by first name and
# gave the disclaimer, the borrower volunteered the bounce reason, and no payment
# commitment was secured (agent only advised a branch visit).
# ---------------------------------------------------------------------------
DISPUTE_SAMPLE = (
    "0.0 - 1.0 (Customer): Hello\n"
    "7.0 - 9.0 (Agent): Very good afternoon. I am talking to sir Raju.\n"
    "10.0 - 11.0 (Customer): Oh\n"
    "13.0 - 14.0 (Customer): Yes,\n"
    "16.0 - 21.0 (Agent): Moneyta is speaking on behalf of ICIC home finance company.\n"
    "22.0 - 23.0 (Customer): Yes, speak.\n"
    "24.0 - 38.0 (Agent): This call is regarding your home loan. For the purpose of call record "
    "quality and training, your loan account number's last 4 digits are 3453. The date is set for "
    "the 5th. The amount is 15987 rupees right?\n"
    "40.0 - 42.0 (Agent): Have you already set up a mandate for sir?\n"
    "48.0 - 48.5 (Customer): Hmm\n"
    "49.0 - 54.0 (Agent): Alright? We can check. Last time, there was a bounce here. Do you know the reason?\n"
    "55.0 - 59.0 (Customer): The reason is nothing. My bank was having a little problem at that "
    "time, and the payment was not being uploaded.\n"
    "60.0 - 78.0 (Customer): I made an online payment again, but it had already been deducted. So "
    "it became a double payment. How will this be adjusted?\n"
    "79.0 - 82.0 (Agent): Yes, sir, you should go to the branch once and confirm it. Alright.\n"
    "83.0 - 88.0 (Agent): No, you should visit the branch. The Siliguri branch is yours, right?\n"
    "89.0 - 90.0 (Customer): Yes\n"
    "91.0 - 96.0 (Agent): Sir, if it's not available, please update that you have already "
    "maintained what amount in the account\n"
    "96.0 - 98.0 (Customer): Yes, ma'am. Yes, ma'am.\n"
)


def test_dispute_sample_rpc_and_disclaimer_pass():
    assert cs.detect_rpc_verification(DISPUTE_SAMPLE)["verified"] is True
    assert cs.detect_recording_disclaimer(DISPUTE_SAMPLE)["present"] is True


def test_dispute_sample_reason_for_delay_asked_and_volunteered():
    out = cs.detect_delay_probe(DISPUTE_SAMPLE)
    assert out["asked"] is True
    assert out["proactive"] is True


def test_dispute_sample_no_commitment_from_bare_acknowledgement():
    # "Yes ma'am" after an agent aside is acknowledgement, not a promise.
    out = cs.detect_commitment(DISPUTE_SAMPLE)
    assert out["present"] is False


def test_dispute_sample_payload():
    parsed = {
        "dim_results": {
            **{d["key"]: {"score": 80.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
            "Payment Confirmation": {"score": 20.0, "status": "Fail", "evidence": "no confirmation"},
            "Negotiation Quality": {"score": 30.0, "status": "Fail", "evidence": "no probing"},
            "PTP Success Rate": {"score": 20.0, "status": "Fail", "evidence": "no ptp"},
        },
        "ptp": {"present": "No", "genuineness": "Not Applicable", "propensity": "Low",
                "summary": "No concrete payment commitment was secured."},
        "fraud": {}, "ztp": {},
        "summary": ("The agent did not confirm the borrower's identity, failed to provide a "
                    "recording disclaimer, and did not secure a payment commitment."),
        "feedback": "Focus on payment confirmation and negotiation.",
        "disposition": "Dispute",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, DISPUTE_SAMPLE, "", "Hindi", org_name="ICIC Home Finance Company"
    )
    coll = scores["Collections"]
    dims = coll["dimensions"]
    assert dims["RPC_Verification"]["status"] == "Pass"
    assert coll["fatalTriggered"] == "No"
    assert dims["Recording_Disclaimer"]["status"] == "Pass"
    assert dims["Reason_For_Delay"]["status"] == "Pass"
    # No commitment -> PTP stays failed and PTP is not reported as secured.
    assert dims["PTP_Success_Rate"]["status"] == "Fail"
    assert coll["ptp"]["present"] == "No"
    # "Dispute" is not a disposition in the client's CRM.
    assert coll["disposition"] in cs.CRM_DISPOSITIONS
    assert coll["disposition"] == "No Promise-Call back"
    # The summary must not claim missing identity/disclaimer steps that happened.
    low = scores["Summary"].lower()
    assert "did not confirm the borrower" not in low
    assert "failed to provide a recording disclaimer" not in low


# ---------------------------------------------------------------------------
# Real Raju bilingual fixture (prod ASR original + English that dropped the
# disclaimer). Detectors must Pass compliance from the original view; English
# alone must NOT be enough for disclaimer. Affirm arrives after filler turns.
# ---------------------------------------------------------------------------
RAJU_ORIGINAL = (
    "0.0 - 1.0 (Customer): हेलो\n"
    "7.0 - 9.0 (Agent): Very good afternoon. I am talking to sir Raju.\n"
    "10.0 - 11.0 (Customer): आह\n"
    "13.0 - 14.0 (Agent): पैसे\n"
    "17.0 - 18.0 (Customer): हेलो\n"
    "19.0 - 21.0 (Agent): आवाज आ रही है अगो, सर रोए थे\n"
    "20.0 - 21.0 (Customer): Yeah,\n"
    "23.0 - 26.0 (Agent): मनीता बोल रही है ITI के home finance company के तरफ से\n"
    "27.0 - 28.0 (Customer): हाँ बोलिये\n"
    "28.0 - 42.0 (Agent): Call कर आप के home loan के regarding है call record के जरा "
    "quality और training purpose के regarding loan account number है last के 4 digits "
    "3453 पांच तारीख का date तय है 15,987 rupees right\n"
    "43.0 - 44.0 (Customer): Certician, account balance, madam\n"
    "45.0 - 47.0 (Agent): आप सर को already maintain करके रखा है क्या आपने?\n"
    "48.0 - 48.5 (Customer): हम्म\n"
    "49.0 - 54.0 (Agent): ठीक है ना? चेक कर पायेंगे last time आप के यहीं में बाउंस "
    "हुआ था। Reason जान सकती हूँ?\n"
    "55.0 - 60.0 (Customer): Reason nothing is my bank was having a little problem "
    "at that time payment was not being uploaded.\n"
    "105.0 - 108.0 (Agent): हाँ तो वो branch में जाके एक बार confirm कर लीजियेगा sir ठीक है\n"
    "126.0 - 131.0 (Agent): जी नहीं है तो अब आप update करने दे दीजिये कि आप already "
    "यहा क्या amount account में maintain करके रख लीजिये\n"
    "131.0 - 133.0 (Customer): Yes, ma'am. Yes, ma'am.\n"
)

RAJU_ENGLISH = (
    "0.0 - 1.0 (Customer): Hello\n"
    "7.0 - 9.0 (Agent): Very good afternoon. I am talking to sir Raju.\n"
    "10.0 - 11.0 (Customer): Oh\n"
    "13.0 - 14.0 (Agent): Money\n"
    "17.0 - 18.0 (Customer): Hello\n"
    "19.0 - 21.0 (Agent): The voice is coming through, sir Raju was crying\n"
    "20.0 - 21.0 (Customer): Yes,\n"
    "23.0 - 26.0 (Agent): Moneyta is speaking on behalf of ITI's home finance company\n"
    "27.0 - 28.0 (Customer): Yes, speak\n"
    "28.0 - 42.0 (Agent): The call is regarding your home loan account number, last 4 "
    "digits 3453, date is 5th, 15,987 rupees right\n"
    "43.0 - 44.0 (Customer): Certician, account balance, madam\n"
    "45.0 - 47.0 (Agent): Have you already set up a mandate for sir?\n"
    "48.0 - 48.5 (Customer): Hmm\n"
    "49.0 - 54.0 (Agent): Alright? We can check. Last time, there was a bounce here. "
    "Do you know the reason?\n"
    "55.0 - 60.0 (Customer): The reason is nothing. My bank had a little problem at "
    "that time, and the payment was not uploaded.\n"
    "105.0 - 108.0 (Agent): Yes, sir, you should go to the branch once and confirm it. Alright.\n"
    "126.0 - 131.0 (Agent): Sir, if it's not available, please allow us to update that "
    "you have already maintained what amount in the account\n"
    "131.0 - 133.0 (Customer): Yes, ma'am. Yes, ma'am.\n"
)


def test_raju_english_alone_drops_disclaimer():
    assert cs.detect_recording_disclaimer(RAJU_ENGLISH)["present"] is False


def test_raju_bilingual_detectors_pass_compliance():
    org = "ICIC Home Finance Company"
    assert cs.detect_rpc_verification(RAJU_ORIGINAL, RAJU_ENGLISH)["verified"] is True
    assert cs.detect_recording_disclaimer(RAJU_ORIGINAL, RAJU_ENGLISH)["present"] is True
    intro = cs.detect_self_introduction(org, RAJU_ORIGINAL, RAJU_ENGLISH)
    assert intro["greetingGiven"] and intro["nameGiven"] and intro["companyGiven"]
    assert cs.detect_commitment(RAJU_ORIGINAL, RAJU_ENGLISH)["present"] is False


def test_raju_bilingual_payload_no_fatal():
    org = "ICIC Home Finance Company"
    parsed = {
        "dim_results": {
            **{d["key"]: {"score": 70.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
            "RPC Verification": {"score": 0.0, "status": "Fail", "evidence": "LLM false miss"},
            "Recording Disclaimer": {"score": 0.0, "status": "Fail", "evidence": "LLM false miss"},
            "Self Introduction": {"score": 0.0, "status": "Fail", "evidence": "LLM false miss"},
            "PTP Success Rate": {"score": 0.0, "status": "Fail", "evidence": "no ptp"},
            "Payment Confirmation": {"score": 0.0, "status": "Fail", "evidence": "no confirmation"},
            "Negotiation Quality": {"score": 0.0, "status": "Fail", "evidence": "weak"},
            "Politeness and Empathy": {"score": 0.0, "status": "Fail", "evidence": "cold"},
            "Sentiment Analysis": {"score": 0.0, "status": "Fail", "evidence": "neg"},
            "Unusual Patterns": {"score": 0.0, "status": "Fail", "evidence": "guess"},
            "Agent Tone and Clarity": {"score": 20.0, "status": "Fail", "evidence": "rushed"},
        },
        "ptp": {"present": "No", "genuineness": "Not Applicable", "propensity": "Low",
                "amount": 0, "summary": "Branch redirect only."},
        "fraud": {}, "ztp": {},
        "summary": ("Confirm the borrower's identity, obtain a commitment to pay. "
                    "The borrower explained the bounce reason, but no resolution was confirmed."),
        "feedback": "Improve RPC and disclaimer.",
        "disposition": "No Promise-Call back",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, RAJU_ORIGINAL, RAJU_ENGLISH, "Hindi", org_name=org
    )
    coll = scores["Collections"]
    dims = coll["dimensions"]
    assert dims["RPC_Verification"]["status"] == "Pass"
    assert dims["Recording_Disclaimer"]["status"] == "Pass"
    assert dims["Self_Introduction"]["status"] == "Pass"
    assert dims["Reason_For_Delay"]["status"] == "Pass"
    assert dims["Unusual_Patterns"]["status"] == "Pass"
    assert dims["Politeness_Empathy"]["status"] == "Pass"
    assert dims["Negotiation_Quality"]["status"] == "Pass"
    assert dims["PTP_Success_Rate"]["status"] == "Fail"
    assert coll["fatalTriggered"] == "No"
    assert coll["disposition"] == "No Promise-Call back"
    assert coll["campaign"] == "COLL"
    assert coll["ptp"]["amount"] in (None, "", "Not confirmed")
    # Mid band — compliance + soft floors, but PTP/payment conf still Fail.
    assert 45.0 <= float(scores["Overall_Scoring"]) <= 80.0
    low = scores["Summary"].lower()
    assert "did not confirm the borrower" not in low
    assert "confirm the borrower's identity" not in low
    assert "failed to provide a recording disclaimer" not in low
    assert "commitment" in low or "resolution" in low


def test_dead_air_over_10s_fails_etiquette():
    t = (
        "0.0 - 5.0 (Agent): namaste, mera naam Rahul hai, ICIC Home Finance se.\n"
        "20.0 - 25.0 (Agent): sorry sir, thank you for holding.\n"
    )
    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "No"}, "fraud": {}, "ztp": {}, "summary": "s", "feedback": "f",
        "disposition": "Call Back (Plain)", "campaign": "COLL",
    }
    scores = cs.build_collections_payload(parsed, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance")
    assert scores["Collections"]["dimensions"]["Telephone_Etiquette"]["status"] == "Fail"


def test_whatsapp_and_otp_are_unusual_patterns():
    whatsapp = cs.detect_personal_channel_fraud(
        "0.0 - 4.0 (Agent): sir screenshot whatsapp par bhej dijiye.\n"
    )
    assert whatsapp["personalChannel"] == "No"
    assert whatsapp["nonOfficialDocumentChannel"] == "Yes"
    assert whatsapp["redAlert"] is False
    otp = cs.detect_personal_channel_fraud(
        "0.0 - 4.0 (Agent): please share the OTP you received.\n"
    )
    assert otp["personalChannel"] == "No"
    assert otp["credentialCapture"] == "Yes"
    assert otp["redAlert"] is False


def test_feedback_drops_advice_for_passed_dimensions():
    dim_results = {
        "Recording Disclaimer": {"score": 100.0, "status": "Pass", "evidence": "given"},
        "Politeness and Empathy": {"score": 20.0, "status": "Fail", "evidence": "curt tone"},
    }
    out = cs.build_feedback(
        "Agent should give the recording disclaimer. Agent should show more empathy.",
        dim_results,
        RUBRIC,
    )
    assert "disclaimer" not in out.lower()
    assert "empathy" in out.lower()


def test_feedback_is_plain_language_without_audit_jargon():
    dim_results = {
        "Self Introduction": {
            "score": 0.0,
            "status": "Fail",
            "evidence": 'Script incomplete - missing agent name. Nearest opening evidence: "नमस्ते लाला राम जी"',
        },
        "Agent Tone and Clarity": {
            "score": 0.0,
            "status": "Fail",
            "evidence": "Not found: Agent spoke in a flat tone. Anchor: 'bounce in April'",
        },
        "Recording Disclaimer": {"score": 100.0, "status": "Pass", "evidence": "given"},
    }
    out = cs.build_feedback("", dim_results, RUBRIC)
    low = out.lower()
    assert "focus on:" not in low
    assert "nearest opening evidence" not in low
    assert "anchor:" not in low
    assert "not found" not in low
    assert "your name" in low
    assert "tone" in low
    assert "disclaimer" not in low


def test_feedback_removes_hallucinated_anchor_but_keeps_spoken_anchor():
    transcript = (
        "0.0 - 5.0 (Customer): My bank account is blocked and payment is not happening.\n"
        "5.0 - 9.0 (Agent): Please try to make the payment today.\n"
    )
    feedback = (
        "Payment Confirmation: Not found. Anchor: 'It will have to be put on hold'. "
        "Reason for delay: Anchor: 'My bank account is blocked and payment is not happening'."
    )
    cleaned = cs.scrub_unsupported_feedback_anchors(feedback, transcript)
    assert "It will have to be put on hold" not in cleaned
    assert "My bank account is blocked" in cleaned


def test_missing_compliance_steps_still_fail():
    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "No"}, "fraud": {}, "ztp": {},
        "summary": "s", "feedback": "f", "disposition": "Call Back (Plain)", "campaign": "COLL",
    }
    t = (
        "0.0 - 5.0 (Agent): aapka payment bounce ho gaya hai, kab karenge?\n"
        "5.0 - 8.0 (Customer): pata nahi.\n"
        "8.0 - 12.0 (Agent): jaldi kariye warna charges lagenge.\n"
        "12.0 - 14.0 (Customer): hmm.\n"
        "14.0 - 18.0 (Agent): theek hai rakhta hoon phone.\n"
    )
    scores = cs.build_collections_payload(parsed, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance")
    dims = scores["Collections"]["dimensions"]
    assert dims["Recording_Disclaimer"]["status"] == "Fail"
    assert dims["Self_Introduction"]["status"] == "Fail"
    assert dims["RPC_Verification"]["status"] == "Fail"
    # RPC failure is fatal to the compliance group.
    assert scores["Collections"]["fatalTriggered"] == "Yes"
    # Bounce discussed but the agent never asked why.
    assert dims["Reason_For_Delay"]["status"] == "Fail"


def test_hardship_without_explicit_empathy_fails_combined_dimension():
    transcript = (
        "0.0 - 4.0 (Agent): Your loan payment is overdue, when will you pay?\n"
        "4.0 - 10.0 (Customer): I retired and my bank account is blocked, so payment is not happening.\n"
        "10.0 - 15.0 (Agent): You must try to pay today, two or three days cannot be given.\n"
    )
    dims = _all("Pass", 90.0)
    evidence = cs.apply_deterministic_criteria(
        dims, RUBRIC, transcript, "", "ICIC Home Finance", call_language="Hindi"
    )
    assert evidence["empathy"]["applicable"] is True
    assert evidence["empathy"]["acknowledged"] is False
    assert dims["Politeness and Empathy"]["status"] == "Fail"
    assert dims["Politeness and Empathy"]["score"] == 0.0


def test_explicit_hardship_acknowledgement_passes_empathy():
    transcript = (
        "0.0 - 4.0 (Customer): I lost my job and I have no funds right now.\n"
        "4.0 - 8.0 (Agent): I understand this is difficult, sir. Let us review the payment options.\n"
    )
    dims = _all("Fail", 0.0)
    evidence = cs.apply_deterministic_criteria(
        dims, RUBRIC, transcript, "", "ICIC Home Finance", call_language="Hindi"
    )
    assert evidence["empathy"]["acknowledged"] is True
    assert dims["Politeness and Empathy"]["status"] == "Pass"
    assert dims["Politeness and Empathy"]["score"] == 100.0


def test_score_breakdown_explains_binary_fatal_and_na_exclusion():
    dims = _all("Pass", 100.0)
    dims["RPC Verification"] = {"score": 0.0, "status": "Fail"}
    dims["Blank Documentation"] = {"score": None, "status": "NA"}
    result = cs.compute_weighted_overall(dims, RUBRIC)
    basis = result["scoreBreakdown"]
    assert basis["method"] == "brd-binary-weighted"
    assert basis["includedWeight"] == 90.0
    assert basis["excludedWeight"] == 10.0
    assert basis["complianceFatal"] is True
    assert basis["complianceWeight"] == 0.0
    assert basis["configuredDimensionCount"] == 14
    assert basis["evaluatedDimensionCount"] == 13
    assert basis["naDimensionCount"] == 1


# --------------------------------------------------------------------------
# Golden regression — the ICIC "Rajendra" call that was WRONGLY red-alerted.
# The agent promotes the OFFICIAL app, DECLINES WhatsApp, and asks for KYC
# (mobile + PAN) for onboarding. None of this is a personal-payment-channel
# breach; the old detector fired on "PAN card number" (KYC identity mistaken for
# a payment-card credential) + any global payment mention. Lock the correct
# behaviour so no future keyword tweak silently re-introduces the false ZTP.
# --------------------------------------------------------------------------
RAJENDRA_ENGLISH = (
    "8.0 - 12.0 (Agent): Alright, speaking with you, sir. Are you there, sir?\n"
    "12.0 - 14.0 (Customer): Possibly.\n"
    "14.0 - 35.0 (Agent): This is from ICIC Home Finance Company, sir. Good morning. I'm calling "
    "regarding your home loan. This call is being recorded for quality and training purposes. Your "
    "loan account number is 9497. The last call was about an EMI of 13,303 rupees. Your new due date "
    "is coming up, sir. Please make the payment by the 10th.\n"
    "35.0 - 36.0 (Customer): I will be madam.\n"
    "36.0 - 56.0 (Agent): You can do this. On the 10th, in the previous month, your EMI bounced. You "
    "made the payment on the 23rd. What was the reason for the late payment, sir? This month, you "
    "shouldn't let it bounce again. Please maintain the balance by the 8th or 9th, as the EMI is due.\n"
    "56.0 - 57.0 (Customer): Salary\n"
    "57.0 - 72.0 (Agent): Alright, if you make the payment on or after the due date, the EMI will "
    "bounce. Then, a bounce charge of 590 rupees will be applied, and a penalty charge of 1.5 points "
    "per month will be added, calculated daily. This will damage your CIBIL score, sir.\n"
    "72.0 - 73.0 (Customer): What should I do?\n"
    "73.0 - 81.0 (Agent): Alright, please make the payment. Sir, there is an app to help you. Have you "
    "downloaded it yet?\n"
    "81.0 - 83.0 (Customer): He is talking, brother.\n"
    "83.0 - 97.0 (Agent): Sir, go to the app store and search for ICICI Home Finance. Download that "
    "app. With that app, you can check your account statement. If your EMI bounces, you can make the "
    "payment through the app. There are many benefits to downloading the app on your phone. Alright.\n"
    "97.0 - 100.0 (Customer): I'll send it to you on WhatsApp.\n"
    "100.0 - 106.0 (Agent): Sir, you don't need to send it on WhatsApp. You can search for it on the "
    "play store, and it will come to you.\n"
    "106.0 - 108.0 (Customer): What's his name?\n"
    "108.0 - 111.0 (Agent): ICICI Home Finance\n"
    "111.0 - 112.0 (Customer): No, these people.\n"
    "112.0 - 113.0 (Agent): Alright, let it be done.\n"
    "113.0 - 115.0 (Customer): I have to add the phone number.\n"
    "115.0 - 121.0 (Agent): No, you will enter your mobile number and PAN card number. Alright.\n"
    "121.0 - 122.0 (Customer): Okay.\n"
    "122.0 - 129.0 (Agent): Okay, your mobile number, that is how your statement will show.\n"
    "129.0 - 134.0 (Agent): Alright, get this done before the date, and any alternate number to update?\n"
    "134.0 - 138.0 (Customer): No, there is only 1 number, only 1 person.\n"
    "138.0 - 150.0 (Agent): Alright thank you, speaking on behalf of ICIC Home Finance Company.\n"
)

RAJENDRA_ORIGINAL = (
    "14.0 - 35.0 (Agent): ICICI के होम फाइनेंस से sir good morning, आपके होम लोन के बारे में call किया है, call "
    "record हो रही है quality and training purpose की, 9497 loan account, तेरह हजार तीन सौ तीन रुपये का EMI है, "
    "new date दस तारीख को है, balance maintain कर दीजियेगा.\n"
    "35.0 - 36.0 (Customer): I will.\n"
    "83.0 - 97.0 (Agent): play store पे जाके ICICI home finance search कीजियेगा, वो app download कर लीजियेगा, "
    "उससे account statement check कर सकते हो.\n"
    "97.0 - 100.0 (Customer): WhatsApp पे भेज दीजिये.\n"
    "100.0 - 106.0 (Agent): Sir, you don't have to send it on WhatsApp, you can search on the play "
    "store and it will come to you.\n"
    "113.0 - 115.0 (Customer): phone number add karna hai.\n"
    "115.0 - 121.0 (Agent): नहीं, आप अपना मोबाइल नंबर डालोगे ना और PAN card number, तो हो जायेगा, ठीक है.\n"
    "138.0 - 150.0 (Agent): ठीक है thank you, ICICI home finance company से.\n"
)


# Exact shape of the ICICI HFC Tamil production false-positive reported on
# 2026-08-14: official Android-app onboarding was misread as personal payment
# solely because the translated turn contained PAN + OTP.
NIXON_APP_LOGIN_ENGLISH = (
    "1.0 - 4.0 (Agent): Sir, good afternoon, Mr. Nixon sir.\n"
    "4.0 - 6.0 (Customer): Yes, okay.\n"
    "6.0 - 10.0 (Agent): Sir, ICICI Home Finance Company, Mr. Akbar speaking sir.\n"
    "10.0 - 23.0 (Agent): This is an EMI reminder for housing loan 5081. EMI date is the tenth "
    "and the amount is 15,015 rupees. Please maintain cash before the due date in the account.\n"
    "23.0 - 25.0 (Customer): Okay.\n"
    "25.0 - 31.0 (Agent): In case of delay, 590 rupees cheque bounce charge may be added.\n"
    "31.0 - 36.0 (Agent): Do you use the ICICI Home Finance application?\n"
    "36.0 - 37.0 (Customer): No.\n"
    "37.0 - 51.0 (Agent): Install the ICICI Home Finance application on an Android phone. "
    "You can make payment and check the loan statement in the application.\n"
    "51.0 - 53.0 (Customer): Is it on iOS?\n"
    "53.0 - 69.0 (Agent): It does not support iOS, only Android. For login it asks for your PAN "
    "card number, an automatic OTP will come, enter the OTP and you will immediately log in sir.\n"
    "69.0 - 72.0 (Customer): Okay.\n"
    "72.0 - 75.0 (Customer): Has the account change become ready?\n"
    "75.0 - 88.0 (Agent): It is not updated yet, so I cannot check it now. You can check "
    "which account is linked for auto debit in the ICICI Home Finance application.\n"
    "88.0 - 90.0 (Customer): Okay.\n"
    "90.0 - 94.0 (Agent): Thank you sir for giving time to ICICI Home Finance.\n"
)


def test_official_app_pan_otp_login_is_not_personal_payment_or_ztp():
    parsed = {
        "dim_results": {
            **{d["key"]: {"score": 85.0, "status": "Pass", "evidence": "model"} for d in RUBRIC},
            "Self Introduction": {"score": 0.0, "status": "Fail", "evidence": "not introduced"},
            "RPC Verification": {"score": 0.0, "status": "Fail", "evidence": "not verified"},
            "Unusual Patterns": {"score": 0.0, "status": "Fail", "evidence": "OTP"},
            "PTP Success Rate": {"score": 0.0, "status": "Fail", "evidence": "no promise"},
            "Payment Confirmation": {"score": 0.0, "status": "Fail", "evidence": "no resolution"},
            "Negotiation Quality": {"score": 0.0, "status": "Fail", "evidence": "no urgency"},
        },
        "ptp": {"present": "No", "genuineness": "Not Applicable", "propensity": "Low"},
        "fraud": {"personalChannel": "Yes", "channels": ["otp"]},
        "ztp": {
            "violation": "Yes",
            "categories": ["Personal / non-official payment channel"],
            "evidence": "an automatic OTP will come, enter the OTP and you will immediately log in sir",
        },
        "summary": (
            "The agent failed to introduce themselves properly, did not confirm the borrower's identity, "
            "and did not secure a commitment for payment. The call ended without a resolution."
        ),
        "feedback": (
            "RED ALERT: Agent collected payment through a personal channel such as PhonePe or Google Pay."
        ),
        "disposition": "Call Back (Plain)",
        "campaign": "PDM",
    }
    scores = cs.build_collections_payload(
        parsed,
        RUBRIC,
        NIXON_APP_LOGIN_ENGLISH,
        NIXON_APP_LOGIN_ENGLISH,
        "Tamil",
        org_name="ICICI Home Finance Company",
    )
    coll = scores["Collections"]
    fraud = coll["fraud"]
    assert fraud["personalChannel"] == "No"
    assert fraud["credentialCapture"] == "No"
    assert fraud["unusualPattern"] == "No"
    assert fraud["channels"] == []
    assert coll["redAlert"] == "No"
    assert coll["ztpViolation"] == "No"
    assert coll["dimensions"]["Unusual_Patterns"]["status"] == "Pass"
    assert coll["dimensions"]["Self_Introduction"]["status"] == "Pass"
    assert coll["dimensions"]["RPC_Verification"]["status"] == "Pass"
    # PDM reminder completion is not the same thing as a promise: complete
    # information/FCR earns Payment Confirmation, while bare "Okay" keeps PTP No.
    assert coll["ptp"]["present"] == "No"
    assert coll["dimensions"]["PTP_Success_Rate"]["status"] == "Fail"
    assert coll["dimensions"]["Payment_Confirmation"]["status"] == "Pass"
    assert coll["dimensions"]["Negotiation_Quality"]["status"] == "Fail"
    assert coll["dimensions"]["Negotiation_Quality"]["score"] == 0.0
    assert coll["disposition"] == "No Promise-Call back"
    assert 60.0 <= coll["overall"] <= 70.0
    assert not scores["Feedback"].startswith("RED ALERT")
    feedback = scores["Feedback"].lower()
    assert "did not establish urgency" not in feedback
    assert "no urgency" not in feedback
    assert "no explanation of consequences" not in feedback
    assert "created urgency" in feedback
    assert "bounce/late consequences" in feedback
    low_summary = scores["Summary"].lower()
    assert "pre-due emi reminder" in low_summary
    assert "official-app registration" in low_summary
    assert "linked auto-debit account" in low_summary
    assert "failed to introduce" not in low_summary
    assert "without a resolution" not in low_summary


def test_call_back_disposition_requires_an_arranged_callback():
    no_callback = (
        "0.0 - 5.0 (Agent): Your EMI of 5,000 rupees is due on the 10th.\n"
        "5.0 - 7.0 (Customer): Okay.\n"
    )
    assert cs.has_callback_arrangement(no_callback) is False
    assert cs.derive_disposition(
        "Call Back (Plain)", {"present": "No"}, {}, no_callback, cs.detect_commitment(no_callback)
    ) == "No Promise-Call back"

    real_callback = (
        "0.0 - 4.0 (Customer): I am busy, please call me back tomorrow.\n"
        "4.0 - 6.0 (Agent): Okay, I will call you tomorrow.\n"
    )
    assert cs.has_callback_arrangement(real_callback) is True
    assert cs.derive_disposition(
        "Call Back (Plain)", {"present": "No"}, {}, real_callback,
        cs.detect_commitment(real_callback),
    ) == "Call Back (Plain)"


def test_predue_reminder_quality_is_evidence_based_across_calls():
    complete = (
        "0.0 - 7.0 (Agent): Your EMI amount is 8,250 rupees and due date is the 12th. "
        "Please maintain the balance before the due date.\n"
        "7.0 - 9.0 (Customer): Okay.\n"
        "9.0 - 13.0 (Agent): If it bounces a 590 rupees bounce charge may apply.\n"
    )
    evidence = cs.detect_reminder_completion(complete)
    assert evidence["complete"] is True
    assert evidence["urgency"] is True
    assert evidence["consequence"] is True
    assert evidence["paymentProbe"] is False

    incomplete = (
        "0.0 - 5.0 (Agent): This is a reminder about your EMI, please check it.\n"
        "5.0 - 6.0 (Customer): Okay.\n"
    )
    evidence = cs.detect_reminder_completion(incomplete)
    assert evidence["complete"] is False
    assert evidence["amount"] is False
    assert evidence["mode"] is False

    probed = (
        "0.0 - 7.0 (Agent): Your EMI amount is 8,250 rupees and due date is the 12th. "
        "Please maintain the balance before the due date.\n"
        "7.0 - 9.0 (Customer): Okay.\n"
        "9.0 - 15.0 (Agent): A 590 rupees bounce charge may apply. Can you maintain the balance?\n"
        "15.0 - 17.0 (Customer): I will maintain it tomorrow.\n"
    )
    evidence = cs.detect_reminder_completion(probed)
    assert evidence["paymentProbe"] is True


def test_otp_arrival_does_not_hide_a_real_disclosure_request():
    out = cs.detect_personal_channel_fraud(
        "0.0 - 5.0 (Agent): An automatic OTP will come; tell me the OTP when you receive it.\n"
    )
    assert out["personalChannel"] == "No"
    assert out["credentialCapture"] == "Yes"
    assert out["redAlert"] is False


def test_personal_payment_is_not_hidden_by_official_word_in_same_turn():
    out = cs.detect_personal_channel_fraud(
        "0.0 - 5.0 (Agent): Do not use the official app; pay the amount to my personal UPI.\n"
    )
    assert out["personalChannel"] == "Yes"
    assert out["redAlert"] is True


def test_agent_declining_personal_payment_is_clean():
    out = cs.detect_personal_channel_fraud(
        "0.0 - 5.0 (Agent): Do not pay to my personal account; use the official HFC app.\n"
    )
    assert out["personalChannel"] == "No"
    assert out["unusualPattern"] == "No"
    assert out["redAlert"] is False


LOAN_NOT_PERSONAL_TURNS = (
    # Exact English translation that zeroed the user's call.
    "0.0 - 8.0 (Agent): Okay sir, please try to make the payment as soon as possible. "
    "When you make the payment, it needs to be deposited into your loan account, "
    "not into any personal account.\n",
    # Hindi floor script from the same turn (loan number only; no personal destination).
    "0.0 - 8.0 (Agent): Okay ठीक है sir आप try कीजिये की जितनी जल्दी हो सके उतनी जल्दी "
    "आप पेमेंट जमा कर रहे हो पर पेमेंट करते हो तो आपके लोन नंबर पे ही पेमेंट जमा करना है।\n",
    # Nearby English variants the translator or a bilingual mix can produce.
    "0.0 - 5.0 (Agent): Deposit the EMI into your loan account, not in any personal account.\n",
    "0.0 - 5.0 (Agent): Pay only to your loan account, not to any other account.\n",
    "0.0 - 5.0 (Agent): Payment aapke loan account me hi jama karni hai, personal account me nahi.\n",
    "0.0 - 5.0 (Agent): लोन अकाउंट में ही जमा करना है, किसी और अकाउंट में नहीं।\n",
    "0.0 - 5.0 (Agent): पर्सनल अकाउंट में पेमेंट मत करना, लोन अकाउंट में जमा करना है।\n",
)


def test_loan_account_not_personal_is_not_a_fatal_channel():
    for line in LOAN_NOT_PERSONAL_TURNS:
        out = cs.detect_personal_channel_fraud(line)
        assert out["personalChannel"] == "No", line
        assert out["redAlert"] is False, line
        assert out["unusualPattern"] == "No", line


def test_bilingual_loan_not_personal_mix_is_clean():
    """Prod evidence concatenates Hindi original + English translation of one turn."""
    original = (
        "211.0 - 221.0 (Agent): Okay ठीक है sir आप try कीजिये की जितनी जल्दी हो सके "
        "उतनी जल्दी आप पेमेंट जमा कर रहे हो पर पेमेंट करते हो तो आपके लोन नंबर पे ही "
        "पेमेंट जमा करना है।\n"
    )
    english = (
        "211.0 - 221.0 (Agent): Okay sir, please try to make the payment as soon as possible. "
        "When you make the payment, it needs to be deposited into your loan account, "
        "not into any personal account.\n"
    )
    out = cs.detect_personal_channel_fraud(original, english)
    assert out["personalChannel"] == "No"
    assert out["redAlert"] is False


def test_official_payment_link_is_not_personal_channel():
    """ICICI HFC / any tenant: official SMS/app/link is a company path, not fraud."""
    for line in (
        "0.0 - 8.0 (Agent): A link has been sent to you to make the payment. "
        "You can also make the payment through the link.\n",
        "0.0 - 8.0 (Agent): Maine aapko payment link bhej diya hai, uss link se payment kar lijiye.\n",
        "0.0 - 8.0 (Agent): आपको पेमेंट लिंक भेज दिया है, लिंक से भुगतान कर लीजिए।\n",
        "0.0 - 8.0 (Agent): आम्ही अधिकृत पेमेंट लिंक पाठवली आहे, त्या लिंकद्वारे पेमेंट करा.\n",
        "0.0 - 8.0 (Agent): Official app ya Home Finance application se payment kar sakte hain. "
        "Play Store se download kijiye. Goodscore se bhi pay kar sakte ho.\n",
    ):
        out = cs.detect_personal_channel_fraud(line)
        assert out["personalChannel"] == "No", line
        assert out["redAlert"] is False, line


def test_from_my_account_is_source_not_agent_wallet():
    """Hypothetical / borrower debit from an account is not pay-to-agent."""
    line = (
        "0.0 - 6.0 (Agent): I mean, if I make a payment of ₹2,000 and another "
        "₹2,300 from my account now, then if I do this, it will be 1\n"
    )
    out = cs.detect_personal_channel_fraud(line)
    assert out["personalChannel"] == "No"
    assert out["redAlert"] is False


def test_official_link_plus_from_my_account_is_not_red_alert():
    """Rajendra-class COLL: official link + debit-from language must stay clean."""
    transcript = (
        "0.0 - 20.0 (Agent): A link has been sent to you to make the payment. "
        "You can also make the payment through the link.\n"
        "20.0 - 30.0 (Customer): Okay, the payment was made yesterday, madam.\n"
        "220.0 - 230.0 (Agent): I mean, if I make a payment of ₹2,000 and another "
        "₹2,300 from my account now, then if I do this, it will be 1\n"
        "230.0 - 240.0 (Agent): Have you downloaded the Home Finance application?\n"
    )
    out = cs.detect_personal_channel_fraud(transcript)
    assert out["personalChannel"] == "No"
    assert out["redAlert"] is False


def test_pay_to_my_account_or_personal_number_still_red_alert():
    for line in (
        "0.0 - 4.0 (Agent): payment mere account me daal do.\n",
        "0.0 - 4.0 (Agent): mere personal mobile number pe payment kar dijiye.\n",
        "0.0 - 4.0 (Agent): Send the money to my account now.\n",
        "0.0 - 4.0 (Agent): मेरे पर्सनल नंबर पर पेमेंट भेज दीजिए।\n",
    ):
        out = cs.detect_personal_channel_fraud(line)
        assert out["personalChannel"] == "Yes", line
        assert out["redAlert"] is True, line


def test_pan_card_number_is_kyc_not_fraud():
    # PAN / Aadhaar card NUMBER is KYC identity for official onboarding, never a
    # payment-card credential — the exact trigger of the Rajendra false positive.
    for line in (
        "0.0 - 4.0 (Agent): No, you will enter your mobile number and PAN card number. Alright.\n",
        "0.0 - 4.0 (Agent): app me apna PAN card number aur Aadhaar card number daaliye.\n",
    ):
        assert cs.detect_personal_channel_fraud(line)["personalChannel"] == "No", line


def test_real_card_credential_capture_still_fraud():
    # A genuine payment-card credential ask (no identity-doc qualifier) still fails.
    for line in (
        "0.0 - 4.0 (Agent): sir apna debit card number aur CVV bata dijiye.\n",
        "0.0 - 4.0 (Agent): please share the OTP and card pin.\n",
    ):
        out = cs.detect_personal_channel_fraud(line)
        assert out["personalChannel"] == "No", line
        assert out["credentialCapture"] == "Yes", line
        assert out["redAlert"] is False


def test_decline_whatsapp_is_not_fraud():
    # Steering AWAY from WhatsApp to the official app is a POSITIVE, not a breach.
    for line in (
        "0.0 - 4.0 (Agent): Sir, you don't need to send it on WhatsApp, use the official app.\n",
        "0.0 - 4.0 (Agent): WhatsApp par bhejne ki zarurat nahi, play store se app le lijiye.\n",
        "0.0 - 4.0 (Agent): you don't have to send it on WhatsApp, search on the play store.\n",
    ):
        assert cs.detect_personal_channel_fraud(line)["personalChannel"] == "No", line


def test_steer_to_whatsapp_still_flagged():
    # Guard against over-suppression: pushing docs/payment TO WhatsApp is a breach.
    out = cs.detect_personal_channel_fraud(
        "0.0 - 4.0 (Agent): sir screenshot whatsapp par bhej dijiye abhi.\n"
    )
    assert out["personalChannel"] == "No"
    assert out["nonOfficialDocumentChannel"] == "Yes"
    assert out["redAlert"] is False


def test_whatsapp_callback_number_is_not_document_channel():
    """Audio_058: exchanging a senior's WhatsApp number for a callback is not a doc ZTP."""
    t = (
        "0.0 - 4.0 (Agent): namaste, call record ho rahi hai.\n"
        "113.0 - 129.0 (Agent): Yes, sir Salman, right? There is no issue on Wednesday, "
        "but when you go, take a WhatsApp number from the senior's number and send a "
        "message there. Then they will call me on that number.\n"
        "156.0 - 176.0 (Agent): I will send you the senior's number on WhatsApp with a hello. "
        "Then you go to that number and call.\n"
    )
    out = cs.detect_personal_channel_fraud(t)
    assert out["personalChannel"] == "No"
    assert out["nonOfficialDocumentChannel"] == "No"
    assert out["unusualPattern"] == "No"
    assert out["redAlert"] is False

    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {
            "violation": "Yes",
            "categories": ["Non-official document channel", "Unusual Patterns"],
            "evidence": "Yes, sir Salman, right? There is no issue on Wednesday",
        },
        "summary": "Agent asked the borrower to use WhatsApp.",
        "feedback": "Do not use WhatsApp.",
        "disposition": "Call Back (Plain)",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, t, t, "Hindi", org_name="ICIC Home Finance",
    )
    coll = scores["Collections"]
    assert coll["fraud"]["personalChannel"] == "No"
    assert coll["fraud"]["nonOfficialDocumentChannel"] == "No"
    assert coll["ztpViolation"] == "No"
    assert "document" not in " ".join(coll["ztpCategories"]).lower()
    assert coll["dimensions"]["Unusual_Patterns"]["status"] == "Pass"


def test_unrelated_emi_mention_does_not_manufacture_red_alert():
    # A KYC/app turn plus an unrelated EMI-reminder turn must NOT combine into a
    # money-moved-through-personal-channel red alert (old global-OR bug).
    t = (
        "0.0 - 6.0 (Agent): please make the EMI payment of 13303 rupees by the 10th.\n"
        "6.0 - 10.0 (Agent): you will enter your mobile number and PAN card number in the official app.\n"
    )
    out = cs.detect_personal_channel_fraud(t)
    assert out["personalChannel"] == "No"
    assert out["redAlert"] is False


def test_llm_cannot_keep_personal_fatal_on_loan_not_personal_script():
    english = (
        "0.0 - 6.0 (Agent): namaste, mera naam Rahul hai, ICIC Home Finance se, call record ho rahi hai. Am I speaking to Mr Sharma?\n"
        "6.0 - 8.0 (Customer): haan ji, main Sharma bol raha hoon.\n"
        "8.0 - 16.0 (Agent): When you make the payment, it needs to be deposited "
        "into your loan account, not into any personal account.\n"
        "16.0 - 18.0 (Customer): Right sir, right sir.\n"
    )
    parsed = {
        "dim_results": {d["key"]: {"score": 85.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "Yes", "genuineness": "Genuine", "propensity": "High"},
        "fraud": {"personalChannel": "Yes", "channels": ["personal account"],
                  "evidence": "not into any personal account"},
        "ztp": {"violation": "Yes", "categories": ["Personal payment destination"],
                "evidence": "deposited into your loan account, not into any personal account"},
        "summary": "Agent directed payment to a personal account.",
        "feedback": "Never ask the customer to pay to a personal UPI or account.",
        "disposition": "Promise to Pay", "campaign": "COLL",
    }
    out = cs.build_collections_payload(
        parsed, RUBRIC, english, english, "Hindi", org_name="ICIC Home Finance",
    )
    coll = out["Collections"]
    assert coll["fraud"]["personalChannel"] == "No"
    assert coll["redAlert"] == "No"
    assert coll["ztpViolation"] == "No"
    assert coll["fatalTriggered"] == "No"
    assert "personal payment destination" not in " ".join(coll["ztpCategories"]).lower()
    assert coll["dimensions"]["Unusual_Patterns"]["status"] == "Pass"
    assert "RED ALERT" not in (out.get("Feedback") or "").upper()
    assert "personal account" not in (out.get("Summary") or "").lower()


def test_rajendra_call_is_not_a_red_alert():
    # Reproduce the ACTUAL prod LLM output: the 14B raised a WhatsApp ZTP with a
    # real-quote evidence (a DECLINE) and a false "suggested using WhatsApp"
    # summary. Both must be vetoed by the context-aware detector.
    parsed = {
        "dim_results": {
            **{d["key"]: {"score": 85.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
            "PTP Success Rate": {"score": 30.0, "status": "Fail", "evidence": "no firm date"},
            "Payment Confirmation": {"score": 30.0, "status": "Fail", "evidence": "no resolution"},
        },
        "ptp": {"present": "No", "genuineness": "Not Applicable", "propensity": "Low"},
        "fraud": {"personalChannel": "Yes", "channels": ["whatsapp"],
                  "evidence": "you don't need to send it on WhatsApp"},
        "ztp": {"violation": "Yes", "categories": ["WhatsApp"],
                "evidence": "Sir, you don't need to send it on WhatsApp."},
        "summary": ("The agent did not confirm the borrower's identity, suggested using WhatsApp, "
                    "which is not an official channel. No commitment to pay was made by the borrower."),
        "feedback": "Secure a firm PTP date next time.",
        "disposition": "No Promise-Call back", "campaign": "COLL",
    }
    scores = cs.build_collections_payload(
        parsed, RUBRIC, RAJENDRA_ORIGINAL, RAJENDRA_ENGLISH, "Hindi",
        org_name="ICIC Home Finance Company",
    )
    coll = scores["Collections"]
    # The core fix: no personal-channel fraud, no ZTP and no red alert. RPC is
    # independently fatal because the borrower was not identified by name.
    assert coll["fraud"]["personalChannel"] == "No"
    assert coll["redAlert"] == "No"
    assert coll["ztpViolation"] == "No"
    assert "whatsapp" not in [c.lower() for c in coll["ztpCategories"]]
    assert coll["dimensions"]["Unusual_Patterns"]["status"] == "Pass"
    assert coll["overall"] == 0.0
    assert coll["fatalTriggered"] == "Yes"
    assert not scores["Feedback"].startswith("RED ALERT")
    # The false WhatsApp accusation is scrubbed from the summary.
    assert "whatsapp" not in scores["Summary"].lower()


def test_llm_whatsapp_ztp_vetoed_when_detector_clean():
    # The exact prod bug: LLM flags a WhatsApp ZTP whose evidence is a real quote,
    # but the agent DECLINED WhatsApp and the customer proposed it — detector clean,
    # so the channel ZTP must be vetoed.
    parsed = {
        "dim_results": {d["key"]: {"score": 85.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"}, "fraud": {},
        "ztp": {"violation": "Yes", "categories": ["WhatsApp"],
                "evidence": "you don't need to send it on WhatsApp"},
        "summary": "The agent suggested using WhatsApp. No commitment was made.",
        "feedback": "f", "disposition": "Call Back (Plain)", "campaign": "COLL",
    }
    t = (
        "0.0 - 5.0 (Agent): namaste, call record ho rahi hai, aap official app use kijiye.\n"
        "5.0 - 8.0 (Customer): WhatsApp par bhej dijiye.\n"
        "8.0 - 12.0 (Agent): you don't need to send it on WhatsApp, use the play store app.\n"
    )
    out = cs.build_collections_payload(parsed, RUBRIC, t, t, "Hindi", org_name="ICIC Home Finance")
    coll = out["Collections"]
    assert coll["fraud"]["personalChannel"] == "No"
    assert coll["ztpViolation"] == "No"
    assert "whatsapp" not in out["Summary"].lower()


def test_llm_nonchannel_ztp_still_trusted_with_evidence():
    # A non-channel ZTP the detectors don't cover (e.g. unauthorised waiver) stays
    # LLM-driven when it quotes real evidence — verification, not blanket distrust.
    parsed = {
        "dim_results": {d["key"]: {"score": 85.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"}, "fraud": {},
        "ztp": {"violation": "Yes", "categories": ["Unauthorised waiver"],
                "evidence": "main aapka penalty charge waive kar dunga personally"},
        "summary": "s", "feedback": "f", "disposition": "Call Back (Plain)", "campaign": "COLL",
    }
    t = (
        "0.0 - 5.0 (Agent): namaste, call record ho rahi hai.\n"
        "5.0 - 9.0 (Agent): main aapka penalty charge waive kar dunga personally.\n"
    )
    out = cs.build_collections_payload(parsed, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance")
    coll = out["Collections"]
    assert coll["ztpViolation"] == "Yes"
    assert any("waiver" in c.lower() for c in coll["ztpCategories"])


def test_scrub_channel_accusations_keeps_real_faults():
    s = ("The agent did not confirm the borrower's identity, suggested using WhatsApp, "
         "which is not an official channel. No commitment to pay was made by the borrower.")
    out = cs.scrub_channel_accusations(s)
    assert "whatsapp" not in out.lower()
    assert "identity" in out.lower()
    assert "commitment" in out.lower()


def test_llm_ztp_requires_verifiable_evidence():
    base = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "No"}, "fraud": {},
        "summary": "s", "feedback": "f", "disposition": "Call Back (Plain)", "campaign": "COLL",
    }
    t = (
        "0.0 - 6.0 (Agent): namaste, mera naam Rahul hai, ICIC Home Finance se, call record ho rahi hai.\n"
        "6.0 - 8.0 (Customer): haan ji.\n"
    )
    # Hallucinated ZTP evidence not present in the transcript -> rejected.
    hallucinated = {**base, "ztp": {"violation": "Yes", "categories": ["Personal channel"],
                                    "evidence": "agent asked to pay on his personal phonepe number"}}
    out = cs.build_collections_payload(hallucinated, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance")
    assert out["Collections"]["ztpViolation"] == "No"
    # Real quoted evidence from the transcript -> the 14B judge is trusted.
    grounded = {**base, "ztp": {"violation": "Yes", "categories": ["Third party disclosure"],
                                "evidence": "mera naam Rahul hai, ICIC Home Finance se"}}
    out2 = cs.build_collections_payload(grounded, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance")
    assert out2["Collections"]["ztpViolation"] == "Yes"


def test_false_positive_rpc_summary_is_rebuilt_from_final_facts():
    parsed = {
        "dim_results": {
            d["key"]: {"score": 90.0, "status": "Pass", "evidence": "model"}
            for d in RUBRIC
        },
        "ptp": {"present": "No", "genuineness": "Not Applicable", "propensity": "Low"},
        "fraud": {},
        "ztp": {},
        "summary": (
            "This was a collections follow-up. The borrower was addressed by name "
            "and confirmed the call. No explicit payment commitment was made."
        ),
        "feedback": "All parameters passed.",
        "disposition": "No Promise-Call back",
        "campaign": "COLL",
    }
    t = (
        "0.0 - 3.0 (Agent): I am talking to you without any.\n"
        "4.0 - 5.0 (Customer): Yes.\n"
        "6.0 - 12.0 (Agent): Your loan EMI amount of 12,500 rupees is overdue.\n"
        "13.0 - 18.0 (Customer): My account is blocked, payment is not happening.\n"
        "19.0 - 23.0 (Agent): Can someone help you pay online?\n"
        "24.0 - 27.0 (Customer): I need two or three days.\n"
        "28.0 - 31.0 (Agent): Please try to pay today.\n"
    )
    out = cs.build_collections_payload(
        parsed, RUBRIC, t, "", "Hindi", org_name="ICIC Home Finance Company"
    )
    assert out["Collections"]["dimensions"]["RPC_Verification"]["status"] == "Fail"
    assert "addressed by name" not in out["Summary"].lower()
    assert "confirmed the call" not in out["Summary"].lower()
    assert "blocked or inaccessible bank account" in out["Summary"].lower()


def test_extract_loan_basics_rajendra_style_english():
    # Matches the ICICI HFC Result Scoring screenshot script shape.
    t = (
        "0.0 - 35.0 (Agent): Hello, I am calling from ICICI Home Finance Company regarding your "
        "home loan. Your loan account number's last 4 digits are 9497. Your EMI amount is "
        "13,303 rupees and the due date of the 10th. Please maintain the balance by the "
        "8th or 9th, as the EMI is due.\n"
        "35.0 - 36.0 (Customer): I will be madam.\n"
    )
    out = cs.extract_loan_basics(t)
    assert out["loanType"] == "Home Loan"
    assert out["accountLast4"] == "9497"
    assert out["emiAmount"] == 13303.0
    assert out["dueDate"] == "10th"
    assert out["evidence"]


def test_extract_loan_basics_account_number_is_and_emi_of():
    """Prod ASR/translate often says 'account number is 9497' + 'EMI of 13,033'."""
    eng = (
        "0.0 - 14.0 (Agent): This is from ICICI Home Finance Company, sir. Good morning. "
        "I am calling regarding your home loan. This call is being recorded for quality "
        "and training purposes. Your loan account number is 9497. The last call was about "
        "an EMI of 13,033 rupees. Your new due date is coming up, sir. Please maintain "
        "the balance by the 10th.\n"
        "14.0 - 35.0 (Customer): I will be, madam.\n"
        "35.0 - 56.0 (Agent): Please maintain the balance by the 8th or 9th, because the EMI...\n"
        "56.0 - 72.0 (Agent): Then, a bounce charge of 590 rupees will be applied.\n"
    )
    # Hindi/original often puts the last-4 BEFORE 'loan account'.
    orig = (
        "0.0 - 35.0 (Agent): ICICI के होम फाइनेंस से sir good morning, आपके होम लोन के बारे में "
        "call किया है, 9497 loan account, तेरह हजार तीन सौ तीन रुपये का EMI है, "
        "new date दस तारीख को है, balance maintain कर दीजियेगा.\n"
    )
    out = cs.extract_loan_basics(orig, eng)
    assert out["loanType"] == "Home Loan"
    assert out["accountLast4"] == "9497"
    assert out["emiAmount"] == 13033.0
    assert out["dueDate"] == "10th"


def test_extract_loan_basics_hindi_digits_before_account():
    orig = (
        "0.0 - 20.0 (Agent): होम लोन के बारे में call, 9497 loan account, "
        "EMI 13303 rupees, new date दस तारीख.\n"
    )
    out = cs.extract_loan_basics(orig)
    assert out["loanType"] == "Home Loan"
    assert out["accountLast4"] == "9497"
    assert out["emiAmount"] == 13303.0
    assert out["dueDate"] == "10th"


def test_extract_loan_basics_attached_to_collections_payload():
    parsed = {
        "dim_results": {d["key"]: {"score": 100.0, "status": "Pass", "evidence": "n"} for d in RUBRIC},
        "ptp": {},
        "campaign": "PDM",
        "ztp": {},
        "disposition": "",
    }
    t = (
        "0.0 - 4.0 (Agent): namaste, mera naam Rahul hai, main ICIC Home Finance se bol raha hoon.\n"
        "4.0 - 6.0 (Agent): yeh call quality and training ke liye record ki ja rahi hai.\n"
        "6.0 - 8.0 (Agent): kya main Lala Ram ji se baat kar raha hoon?\n"
        "8.0 - 9.0 (Customer): haan ji.\n"
        "9.0 - 14.0 (Agent): home loan EMI 15,987 rupees hai, due date 10th, last 4 digits 3453, "
        "due date se pehle account me balance maintain kariye.\n"
        "14.0 - 16.0 (Customer): haan theek hai, kal rakh dunga.\n"
    )
    scores = cs.build_collections_payload(parsed, RUBRIC, t, t, "Hindi", org_name="ICIC Home Finance")
    basics = scores["Collections"]["loanBasics"]
    assert basics["loanType"] == "Home Loan"
    assert basics["accountLast4"] == "3453"
    assert basics["emiAmount"] == 15987.0
    assert basics["dueDate"] == "10th"


def test_extract_loan_basics_ignores_bounce_charge_as_emi():
    t = (
        "0.0 - 8.0 (Agent): regarding your home loan last 4 digits 5859. "
        "In case of delay, 590 rupees bounce charge may be added.\n"
    )
    out = cs.extract_loan_basics(t)
    assert out["loanType"] == "Home Loan"
    assert out["accountLast4"] == "5859"
    assert out["emiAmount"] is None


def test_extract_loan_basics_prefers_due_on_over_calendar_20th():
    """Audio_113: 'date of 20th' / '20th has passed' is not the EMI due day."""
    t = (
        "0.0 - 12.0 (Agent): Your loan has a last number 0382 with a date of 20th.\n"
        "38.0 - 70.0 (Agent): Today is the 19th and the 20th has already passed sir "
        "bounce charges 590 total amount is 60,652 rupees.\n"
        "140.0 - 155.0 (Agent): Sir your payment is due on the 10th.\n"
    )
    out = cs.extract_loan_basics(t)
    assert out["accountLast4"] == "0382"
    assert out["dueDate"] == "10th"


def test_translation_prompt_blocks_thane_police_homophone():
    from bank_config import BankConfig
    from prompts.translation import translation_system_prompt

    text = translation_system_prompt(BankConfig(bank_name="ICIC Home Finance Company"))
    low = text.lower()
    assert "thane" in low
    assert "police station" in low
    assert "jail road" in low


THREAT_TRUE_POSITIVES = (
    (
        "100.0 - 110.0 (Agent): If you do not pay today I will send the police to your house.\n",
        "100.0 - 110.0 (Agent): If you do not pay today I will send the police to your house.\n",
        "English",
    ),
    (
        "100.0 - 110.0 (Agent): पैसे नहीं दिए तो पुलिस बुला दूंगा।\n",
        "100.0 - 110.0 (Agent): If you don't pay I will call the police.\n",
        "Hindi",
    ),
    (
        "100.0 - 110.0 (Agent): ना दिले तर मी पोलिस बोलवतो.\n",
        "100.0 - 110.0 (Agent): If you don't pay I will call the police.\n",
        "Marathi",
    ),
    (
        "100.0 - 110.0 (Agent): I will arrest you if this EMI is not paid.\n",
        "100.0 - 110.0 (Agent): I will arrest you if this EMI is not paid.\n",
        "English",
    ),
)


def test_real_police_threats_still_foul():
    with location_taboo_lexicon():
        for original, english, lang in THREAT_TRUE_POSITIVES:
            out = cs.detect_foul(original, english, lang)
            assert out["violation"] == "Yes", (lang, original, out)


def test_abuse_lexeme_still_foul_after_location_filter():
    t = "0.0 - 4.0 (Agent): Madarchod, paisa kab dega?\n"
    with location_taboo_lexicon():
        out = cs.detect_foul(t, t, "Hindi")
    assert out["violation"] == "Yes"
    assert out["agentHits"]


def test_real_police_threat_payload_stays_red_alert():
    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass", "evidence": "ok"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {},
        "summary": "s",
        "feedback": "f",
        "disposition": "Call Back (Plain)",
        "campaign": "COLL",
    }
    t = (
        "0.0 - 4.0 (Agent): namaste, call record ho rahi hai.\n"
        "4.0 - 8.0 (Agent): If you do not pay today I will send the police to your house.\n"
    )
    with location_taboo_lexicon():
        scores = cs.build_collections_payload(
            parsed, RUBRIC, t, t, "English", org_name="ICIC Home Finance Company",
        )
    coll = scores["Collections"]
    assert coll["redAlert"] == "Yes"
    assert coll["ztpViolation"] == "Yes"
    assert coll["overall"] == 0.0
    assert scores["Feedback"].upper().startswith("RED ALERT")


def test_collections_prompt_says_official_gpay_is_not_ztp():
    from bank_config import BankConfig
    from prompts.collections import collections_json_prompt

    text = collections_json_prompt(
        "0.0 - 1.0 (Agent): hello\n",
        BankConfig(bank_name="ICIC Home Finance Company"),
        RUBRIC,
    )
    low = text.lower()
    assert "pay anyone" in low or "loan number" in low
    assert "unusual patterns" in low
    assert "gpay" in low or "google pay" in low


def test_pay_my_gpay_still_fatals_without_needing_the_llm():
    t = (
        "0.0 - 4.0 (Agent): namaste, call record ho rahi hai.\n"
        "4.0 - 8.0 (Agent): amount 3034 daaliye, mere personal GPay par bhej dijiye.\n"
    )
    parsed = {
        "dim_results": {d["key"]: {"score": 90.0, "status": "Pass"} for d in RUBRIC},
        "ptp": {"present": "No"},
        "fraud": {},
        "ztp": {},
        "summary": "s",
        "feedback": "f",
        "disposition": "Call Back (Plain)",
        "campaign": "COLL",
    }
    scores = cs.build_collections_payload(parsed, RUBRIC, t, t, "Hindi", org_name="ICIC Home Finance")
    coll = scores["Collections"]
    assert coll["fraud"]["personalChannel"] == "Yes"
    assert coll["redAlert"] == "Yes"
    assert coll["ztpViolation"] == "Yes"
    assert coll["overall"] == 0.0


def test_due_date_prefers_the_day_the_agent_repeats():
    # Real Audio_113 shape: one garbled early "20 तारीख" against two later
    # mentions of the tenth. Consensus must beat text order.
    agent_text = (
        "आपके जो loan चला है loan की last number 0382 20 तारीख की date है "
        "sir आपका payment दस तारीख का है "
        "सर दस तारीख का है आपका payment करवा लीजिए"
    )
    due, evidence = cs._pick_loan_due_date(agent_text)
    assert due == "10th", f"expected 10th, got {due} from {evidence!r}"


def test_due_date_falls_back_to_earliest_when_attestation_ties():
    agent_text = "20 तारीख की date है sir आपका payment दस तारीख का है"
    due, _ = cs._pick_loan_due_date(agent_text)
    assert due == "20th"


def test_single_strong_due_date_is_unchanged():
    agent_text = "sir आपकी EMI की 10 तारीख है payment कर दीजिए"
    due, _ = cs._pick_loan_due_date(agent_text)
    assert due == "10th"


def test_repeated_today_chatter_never_outvotes_the_real_due_day():
    # The agent says today's date twice and the due day once. Counting raw
    # mentions would return the 19th; the today-veto must prevent that.
    agent_text = (
        "आज 19 तारीख हो गई है आज 19 तारीख हो गई है आपकी due date 5 तारीख है"
    )
    due, evidence = cs._pick_loan_due_date(agent_text)
    assert due == "5th", f"expected 5th, got {due} from {evidence!r}"


def test_evidence_string_stays_the_bare_match_for_display():
    due, evidence = cs._pick_loan_due_date("sir आपकी EMI की 10 तारीख है")
    assert due == "10th"
    assert evidence.strip() == "10 तारीख"


def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"ok   - {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL - {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return failed


if __name__ == "__main__":
    import sys
    sys.exit(1 if _run() else 0)
