/**
 * Default industrial-grade banking query taxonomy.
 * KEEP IN SYNC with ai-mvp/query_categories.py :: DEFAULT_CATEGORIES.
 * Each: { name, description, keywords, color }
 */
const DEFAULT_QUERY_CATEGORIES = [
  { name: "Balance/Account Enquiry", description: "Customer asks about account balance or account details.", keywords: "balance, account balance, how much, available balance, account details", color: "#6366f1" },
  { name: "Mini Statement/Transaction History", description: "Customer asks for recent transactions or a mini statement.", keywords: "last transactions, mini statement, transaction history, last five, recent transactions", color: "#8b5cf6" },
  { name: "ATM/Debit Card Issue", description: "Problem with an existing ATM/debit card — lost, blocked, damaged, stuck.", keywords: "card blocked, lost card, card not working, card stuck, debit card issue, card damaged", color: "#0ea5e9" },
  { name: "ATM/Debit PIN Generation", description: "Customer wants to generate / reset / change the ATM or debit card PIN.", keywords: "generate pin, pin generation, reset pin, forgot pin, change pin, green pin, atm pin", color: "#06b6d4" },
  { name: "New ATM/Debit Card Request", description: "Customer requests a brand new ATM/debit card.", keywords: "new card, apply card, request debit card, new atm card, issue new card", color: "#14b8a6" },
  { name: "Credit Card Issue", description: "Problem with an existing credit card.", keywords: "credit card issue, credit card blocked, credit card limit, credit card bill", color: "#f97316" },
  { name: "Credit Card Request", description: "Customer wants a new credit card.", keywords: "new credit card, apply credit card, credit card eligibility", color: "#fb923c" },
  { name: "Cheque Book Request", description: "Customer requests a cheque book or asks about one.", keywords: "cheque book, chequebook, new cheque book, request cheque", color: "#a3e635" },
  { name: "Fund Transfer Issue (NEFT/RTGS/IMPS/UPI)", description: "Issue or query about transferring money.", keywords: "neft, rtgs, imps, upi, fund transfer, money transfer, transfer failed", color: "#22c55e" },
  { name: "Payment Deducted/Failed Transaction", description: "Money deducted but transaction failed / not credited.", keywords: "payment deducted, money deducted, transaction failed, amount debited, not credited, double debit", color: "#ef4444" },
  { name: "Failed/Disputed Transaction Refund", description: "Customer wants a refund or disputes a transaction.", keywords: "refund, dispute, chargeback, reverse transaction, wrong transaction", color: "#f43f5e" },
  { name: "Net Banking/Mobile App Issue", description: "Login, OTP, or feature problem in net banking or the mobile app.", keywords: "net banking, mobile app, app not working, login issue, otp not received, application issue", color: "#3b82f6" },
  { name: "Account Opening", description: "Customer wants to open a new account.", keywords: "open account, new account, account opening, savings account", color: "#0891b2" },
  { name: "KYC/Document Update", description: "KYC, PAN, Aadhaar or other document update.", keywords: "kyc, pan update, aadhaar, document update, re-kyc, kyc pending", color: "#7c3aed" },
  { name: "Address/Mobile Number Update", description: "Update registered address, mobile number or email.", keywords: "change mobile number, update address, change email, update contact", color: "#9333ea" },
  { name: "Loan Enquiry", description: "Customer enquires about or requests a loan.", keywords: "loan, home loan, car loan, personal loan, loan eligibility, loan interest", color: "#16a34a" },
  { name: "Loan EMI/Repayment", description: "Query about loan EMI, repayment, foreclosure or schedule.", keywords: "emi, loan repayment, foreclosure, prepayment, emi date, loan due", color: "#15803d" },
  { name: "Fixed/Recurring Deposit", description: "Query about FD/RD opening, rates or maturity.", keywords: "fixed deposit, fd, recurring deposit, rd, deposit maturity, fd rate", color: "#ca8a04" },
  { name: "Interest Rate/Charges Enquiry", description: "Customer asks about interest rates, fees or charges.", keywords: "interest rate, charges, fees, penalty, service charge", color: "#d97706" },
  { name: "Cheque/DD Status", description: "Status of a cheque or demand draft.", keywords: "cheque status, dd status, demand draft, cheque clearance, cheque bounce", color: "#84cc16" },
  { name: "Complaint/Grievance", description: "Customer raises a complaint or grievance against service/staff.", keywords: "complaint, grievance, complain, poor service, want to complain", color: "#dc2626" },
  { name: "Fraud/Unauthorized Transaction", description: "Suspected fraud or unauthorized transaction.", keywords: "fraud, unauthorized, scam, hacked, stolen money, suspicious transaction", color: "#b91c1c" },
  { name: "Branch/ATM Locator/Referral", description: "Agent refers customer to a branch/ATM or customer asks location.", keywords: "visit branch, nearest branch, atm location, branch refer, go to branch", color: "#64748b" },
  { name: "Bank Server/Technical Issue", description: "Bank-side server, downtime or technical error.", keywords: "server down, server issue, technical issue, system down, server problem", color: "#0d9488" },
  { name: "Account Statement Request", description: "Customer requests a full account statement.", keywords: "account statement, statement request, email statement, passbook update", color: "#475569" },
  { name: "Other/General Info", description: "Any general information request not covered by other categories.", keywords: "general, information, other, enquiry", color: "#94a3b8" },
];

module.exports = { DEFAULT_QUERY_CATEGORIES };
