/**
 * Default terminology, glossaries, and taboo words for Indian call centers
 * (banking + non-banking). Super Admin can override via Bank Config UI.
 */

const BANKING_PRODUCT_TERMS = [
  "account", "savings account", "current account", "balance", "mini statement",
  "NEFT", "RTGS", "IMPS", "UPI", "KYC", "OTP", "PIN", "ATM", "debit card",
  "credit card", "FD", "fixed deposit", "RD", "recurring deposit", "loan",
  "personal loan", "home loan", "EMI", "interest rate", "branch", "IFSC",
  "passbook", "cheque", "demand draft", "locker", "nominee", "RBI",
  "CIBIL", "credit score", "foreclosure", "NPA", "overdraft", "SMS alert",
];

const NON_BANKING_PRODUCT_TERMS = [
  "order", "order ID", "tracking", "delivery", "shipment", "return", "refund",
  "replacement", "warranty", "subscription", "renewal", "invoice", "billing",
  "support ticket", "escalation", "SLA", "callback", "appointment", "complaint",
  "product", "service plan", "activation", "deactivation", "port", "recharge",
  "plan upgrade", "technical support", "helpdesk", "customer ID",
];

const DEFAULT_GLOSSARY = [
  { source: "खाता", target: "account", language: "Hindi", note: "banking" },
  { source: "बैलेंस", target: "balance", language: "Hindi", note: "banking" },
  { source: "पिन बदलना", target: "change PIN", language: "Hindi", note: "card" },
  { source: "कार्ड ब्लॉक", target: "block card", language: "Hindi", note: "card" },
  { source: "लोन", target: "loan", language: "Hindi", note: "banking" },
  { source: "ईएमआई", target: "EMI", language: "Hindi", note: "loan" },
  { source: "शाखा", target: "branch", language: "Hindi", note: "banking" },
  { source: "चेक", target: "cheque", language: "Hindi", note: "banking" },
  { source: "account number", target: "account number", language: "Hinglish", note: "" },
  { source: "mini statement", target: "mini statement", language: "Hinglish", note: "banking" },
  { source: "passbook update", target: "passbook update", language: "Hinglish", note: "banking" },
  { source: "অ্যাকাউন্ট", target: "account", language: "Bengali", note: "banking" },
  { source: "ব্যালান্স", target: "balance", language: "Bengali", note: "banking" },
  { source: "কার্ড", target: "card", language: "Bengali", note: "card" },
  { source: "লোন", target: "loan", language: "Bengali", note: "banking" },
  { source: "शाखा", target: "branch", language: "Marathi", note: "banking" },
  { source: "खाते", target: "account", language: "Marathi", note: "banking" },
  { source: "அக்கவுண்ட்", target: "account", language: "Tamil", note: "banking" },
  { source: "இருப்பு", target: "balance", language: "Tamil", note: "banking" },
  { source: "ఖాతా", target: "account", language: "Telugu", note: "banking" },
  { source: "బ్యాలెన్స్", target: "balance", language: "Telugu", note: "banking" },
  { source: "ખાતું", target: "account", language: "Gujarati", note: "banking" },
  { source: "બેલેન્સ", target: "balance", language: "Gujarati", note: "banking" },
  { source: "ಖಾತೆ", target: "account", language: "Kannada", note: "banking" },
  { source: "ബാലൻസ്", target: "balance", language: "Malayalam", note: "banking" },
  { source: "ਖਾਤਾ", target: "account", language: "Punjabi", note: "banking" },
  { source: "order cancel", target: "cancel order", language: "English", note: "non-banking" },
  { source: "refund status", target: "refund status", language: "English", note: "non-banking" },
  { source: "tracking ID", target: "tracking ID", language: "English", note: "non-banking" },
  { source: "warranty claim", target: "warranty claim", language: "English", note: "non-banking" },
];

const DEFAULT_TABOO_WORDS = [
  { word: "stupid", language: "English", severity: "medium", appliesTo: "agent", category: "rude" },
  { word: "idiot", language: "English", severity: "high", appliesTo: "agent", category: "rude" },
  { word: "shut up", language: "English", severity: "high", appliesTo: "agent", category: "rude" },
  { word: "damn", language: "English", severity: "low", appliesTo: "agent", category: "rude" },
  { word: "guaranteed profit", language: "English", severity: "high", appliesTo: "agent", category: "compliance" },
  { word: "100% return", language: "English", severity: "high", appliesTo: "agent", category: "compliance" },
  { word: "no risk", language: "English", severity: "high", appliesTo: "agent", category: "compliance" },
  { word: "RBI se permission nahi chahiye", language: "Hindi", severity: "high", appliesTo: "agent", category: "compliance" },
  { word: "पागल", language: "Hindi", severity: "high", appliesTo: "agent", category: "rude" },
  { word: "बेवकूफ", language: "Hindi", severity: "medium", appliesTo: "agent", category: "rude" },
  { word: "चुप", language: "Hindi", severity: "medium", appliesTo: "agent", category: "rude" },
  { word: "বোকা", language: "Bengali", severity: "medium", appliesTo: "agent", category: "rude" },
  { word: "pagol", language: "Hinglish", severity: "medium", appliesTo: "agent", category: "rude" },
  { word: "bakwas", language: "Hinglish", severity: "medium", appliesTo: "agent", category: "rude" },
  { word: "time pass mat karo", language: "Hindi", severity: "medium", appliesTo: "agent", category: "rude" },
  { word: "complaint nahi karna", language: "Hindi", severity: "high", appliesTo: "agent", category: "compliance" },
  { word: "free money", language: "English", severity: "high", appliesTo: "agent", category: "compliance" },
  { word: "double your money", language: "English", severity: "high", appliesTo: "agent", category: "compliance" },
];

const SUPPORTED_LANGUAGES = [
  "Hindi", "Hinglish", "English", "Bengali", "Tamil", "Telugu", "Marathi",
  "Gujarati", "Kannada", "Malayalam", "Punjabi", "Odia", "Assamese", "Urdu", "Any",
];

module.exports = {
  BANKING_PRODUCT_TERMS,
  NON_BANKING_PRODUCT_TERMS,
  DEFAULT_GLOSSARY,
  DEFAULT_TABOO_WORDS,
  SUPPORTED_LANGUAGES,
};
