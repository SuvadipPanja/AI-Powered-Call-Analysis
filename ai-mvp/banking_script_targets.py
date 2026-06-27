"""Script reference sentences with configurable bank name (replaces hardcoded UCO)."""

from __future__ import annotations

DEFAULT_BANK_NAME = "Call Center"

# Templates use {bank} and {bank_local} placeholders.
_SCRIPT_TEMPLATES: dict[str, dict[str, list[str]]] = {
    "Opening Speech": {
        "English": [
            "Welcome to {bank}. How may I assist you today?",
            "Good morning, welcome to {bank}.",
            "Hello, thank you for calling {bank}. How may I serve you?",
            "Thank you for contacting {bank}. How can I be of assistance?",
            "My name is [Agent], how can I help you today?",
            "Good afternoon, this is {bank} customer service.",
        ],
        "Hindi": [
            "{bank_local} में आपका स्वागत है। मैं आपकी क्या मदद कर सकता हूँ?",
            "नमस्ते, {bank_local} में कॉल करने के लिए धन्यवाद।",
            "सुप्रभात, {bank_local} ग्राहक सेवा में आपका स्वागत है।",
        ],
    },
    "Empathy": {
        "English": [
            "I understand your concern.",
            "I apologize for the inconvenience caused.",
            "I am here to help you.",
            "I appreciate your patience in this matter.",
            "I completely understand how frustrating this must be.",
            "I'm sorry to hear about this issue, let me help resolve it.",
            "I can see why this would be concerning for you.",
        ],
        "Hindi": [
            "मैं आपकी चिंता समझता हूँ।",
            "हुई असुविधा के लिए मैं क्षमा चाहता हूँ।",
            "मैं समझ सकता हूँ यह कितना परेशान करने वाला है।",
        ],
    },
    "Query Handling": {
        "English": [
            "Could you please explain your issue in detail?",
            "Let me check that for you.",
            "May I know your account number for verification?",
            "Let me confirm that information for you.",
            "I'm looking into this right now.",
            "Could you provide me with more details about the transaction?",
            "Let me pull up your account information.",
        ],
        "Hindi": [
            "क्या आप कृपया अपनी समस्या विस्तार से बता सकते हैं?",
            "मैं इसे आपके लिए जांचता हूँ।",
            "मैं अभी इसकी जाँच कर रहा हूँ।",
        ],
    },
    "Authentication Verification": {
        "English": [
            "May I verify your account details?",
            "Could you confirm your registered mobile number?",
            "For security, please provide your date of birth.",
            "Let me authenticate your account before proceeding.",
            "Can you please confirm the last four digits of your account number?",
            "For verification purposes, what is your registered email address?",
            "I need to verify your identity before making any changes.",
        ],
        "Hindi": [
            "क्या मैं आपके खाते का विवरण सत्यापित कर सकता हूँ?",
            "कृपया अपना पंजीकृत मोबाइल नंबर बताएं।",
            "सुरक्षा के लिए, कृपया अपनी जन्म तिथि बताएं।",
        ],
    },
    "Resolution": {
        "English": [
            "I have resolved your issue. The transaction has been processed.",
            "Your request has been completed successfully.",
            "The issue has been fixed and you should see the changes within 24 hours.",
            "I've submitted the request and it will be processed within 2 business days.",
            "Your complaint has been registered and our team will follow up.",
        ],
        "Hindi": [
            "आपकी समस्या का समाधान हो गया है।",
            "आपका अनुरोध सफलतापूर्वक पूरा हो गया है।",
        ],
    },
    "Compliance": {
        "English": [
            "As per RBI guidelines, I need to inform you about the charges.",
            "Please note this call is being recorded for quality purposes.",
            "I need to read out the terms and conditions before proceeding.",
            "For regulatory compliance, let me verify your KYC details.",
            "As per our bank policy, I'll need to escalate this to the branch.",
        ],
        "Hindi": [
            "आरबीआई दिशानिर्देशों के अनुसार, मुझे आपको शुल्कों के बारे में सूचित करना है।",
            "कृपया ध्यान दें कि यह कॉल गुणवत्ता उद्देश्यों के लिए रिकॉर्ड की जा रही है।",
        ],
    },
    "Closing Speech": {
        "English": [
            "Thank you for calling {bank}. Have a nice day.",
            "Is there anything else I can help you with today?",
            "Thank you for banking with {bank}.",
            "We appreciate your call. Goodbye.",
            "If you face any further issues, please don't hesitate to call us back.",
            "Thank you for your patience. Have a wonderful day ahead.",
        ],
        "Hindi": [
            "{bank_local} को कॉल करने के लिए धन्यवाद। आपका दिन शुभ हो।",
            "क्या मैं आज आपकी और कोई मदद कर सकता हूँ?",
            "आपके धैर्य के लिए धन्यवाद। आपका दिन शुभ हो।",
        ],
    },
}


def _fill_template(text: str, bank_name: str, bank_name_local: str) -> str:
    local = bank_name_local or bank_name
    return (
        text.replace("{bank}", bank_name)
        .replace("{bank_local}", local)
        .replace("{BANK_NAME}", bank_name)
        .replace("{BANK_NAME_LOCAL}", local)
    )


def build_target_sentences(
    bank_name: str = DEFAULT_BANK_NAME,
    bank_name_local: str = "",
) -> dict[str, dict[str, list[str]]]:
    bank = (bank_name or DEFAULT_BANK_NAME).strip()
    local = (bank_name_local or bank).strip()
    out: dict[str, dict[str, list[str]]] = {}
    for category, by_lang in _SCRIPT_TEMPLATES.items():
        out[category] = {}
        for lang, sentences in by_lang.items():
            out[category][lang] = [
                _fill_template(s, bank, local) for s in sentences
            ]
    return out


# Backward compatibility for imports expecting TARGET_SENTENCES
TARGET_SENTENCES = build_target_sentences()
