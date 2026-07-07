/**
 * Report / dashboard RBAC — Agents may only query their own agent_name scope.
 */
const { resolveAgentIdentity } = require("../agentHelper");

const ELEVATED_ROLES = new Set([
  "Super Admin",
  "Admin",
  "Manager",
  "Team Leader",
  "Auditor",
  "IT",
]);

const DASHBOARD_SCOPE_RE =
  /^\/(metrics-overview|tone-analysis|inbound-outbound|daily-duration|top-scorer|recent-activity)/;

const AGENT_ALLOWED_REPORT_RE =
  /^\/reports\/(agent-performance-metrics|agent-handling-summary|call-resolution-status|language-distribution|tone-sentiment-summary|rubric-comparison)(\/|$)/;

const AGENT_BLOCKED_RE =
  /^\/reports\/(supervisors|locations|realtime-metrics|loan-leads|escalation-summary|lead-classification|query-type-distribution|performance-comparison|call-volume-trends-enhanced|call-distribution-enhanced|call-distribution-hourly|language-distribution-enhanced|call-volume-by-time|language-preferences|inbound-calls-monthly|outbound-calls-weekly|call-distribution-by-day|call-volume-trends)(\/|$)/;

const REPORT_OR_DASHBOARD_RE =
  /^\/(metrics-overview|tone-analysis|inbound-outbound|daily-duration|top-scorer|recent-activity|reports\/)/;

function needsReportScope(path = "") {
  return REPORT_OR_DASHBOARD_RE.test(path);
}

function agentRequestedOtherScope(query = {}, body = {}, allowedAgentName) {
  const allowed = String(allowedAgentName || "").trim().toLowerCase();
  const candidates = [
    query.agent,
    query.agentName,
    body.agent,
    body.agentName,
    body.username,
  ];
  for (const raw of candidates) {
    const value = String(raw || "").trim();
    if (!value || value === "All") continue;
    if (value.toLowerCase() !== allowed) return true;
  }
  return false;
}

function forceAgentScope(query, body, agentName) {
  if (!query || typeof query !== "object") return;
  query.agent = agentName;
  if (body && typeof body === "object") {
    if ("agent" in body || body.agentName) body.agent = agentName;
    if ("agentName" in body) body.agentName = agentName;
  }
}

/**
 * @param {() => Promise<import('mssql').ConnectionPool>} getPool
 */
function createReportScopeMiddleware(getPool) {
  return async function reportScope(req, res, next) {
    if (!needsReportScope(req.path)) return next();

    const user = req.user;
    if (!user?.username) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (user.isService) return next();
    if (ELEVATED_ROLES.has(user.accountType || "")) return next();

    if (user.accountType !== "Agent") return next();

    if (AGENT_BLOCKED_RE.test(req.path)) {
      return res.status(403).json({
        success: false,
        message: "Agents may not access organization-wide reports.",
      });
    }

    if (req.path.startsWith("/reports/") && !AGENT_ALLOWED_REPORT_RE.test(req.path)) {
      if (req.path.startsWith("/reports/download-")) {
        return res.status(403).json({
          success: false,
          message: "Agents may not download organization-wide reports.",
        });
      }
      if (!AGENT_ALLOWED_REPORT_RE.test(req.path)) {
        return res.status(403).json({
          success: false,
          message: "Agents may not access this report.",
        });
      }
    }

    let pool;
    try {
      pool = await getPool();
    } catch (err) {
      return res.status(500).json({ success: false, message: "Database unavailable." });
    }

    const identity = await resolveAgentIdentity(pool, user.username);
    if (!identity?.agentName) {
      return res.status(403).json({
        success: false,
        message: "No agent profile linked to this account.",
      });
    }

    if (agentRequestedOtherScope(req.query, req.body, identity.agentName)) {
      return res.status(403).json({
        success: false,
        message: "Agents may only view their own data.",
      });
    }

    if (DASHBOARD_SCOPE_RE.test(req.path) || AGENT_ALLOWED_REPORT_RE.test(req.path)) {
      forceAgentScope(req.query, req.body, identity.agentName);
    }

    req.reportScope = {
      agentName: identity.agentName,
      agentId: identity.agentId,
      accountType: user.accountType,
      cacheKey: identity.agentName,
    };

    return next();
  };
}

module.exports = { createReportScopeMiddleware, needsReportScope };
