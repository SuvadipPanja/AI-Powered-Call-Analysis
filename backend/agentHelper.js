const sql = require("./sqlClient");

/**
 * Maps a login username (Users.Username or LoginAlias) to the agent record
 * used in AI_Details_Scoring and dbo.Agents.
 */
async function resolveAgentIdentity(pool, loginUsername) {
  const login = String(loginUsername || "").trim();
  if (!login) return null;

  const userRes = await pool.request().input("login", sql.NVarChar, login).query(`
      SELECT TOP 1 Username, Email, LoginAlias, AccountType
      FROM dbo.Users
      WHERE LOWER(Username) = LOWER(@login)
         OR LOWER(LoginAlias) = LOWER(@login)
    `);

  const user = userRes.recordset[0];
  if (!user) return null;

  const agentRes = await pool
    .request()
    .input("uname", sql.NVarChar, user.Username)
    .input("email", sql.NVarChar, user.Email || "")
    .input("alias", sql.NVarChar, user.LoginAlias || "")
    .query(`
      SELECT TOP 1
        agent_id,
        agent_name,
        supervisor,
        manager,
        auditor,
        agent_type,
        agent_email,
        agent_location
      FROM dbo.Agents
      WHERE (is_active = 1 OR is_active IS NULL)
        AND (
          LOWER(agent_name) = LOWER(@uname)
          OR LOWER(agent_email) = LOWER(@email)
          OR LOWER(agent_id) = LOWER(@alias)
          OR (@alias <> '' AND LOWER(agent_name) = LOWER(@alias))
        )
      ORDER BY
        CASE
          WHEN LOWER(agent_name) = LOWER(@uname) THEN 0
          WHEN LOWER(agent_email) = LOWER(@email) THEN 1
          WHEN LOWER(agent_id) = LOWER(@alias) THEN 2
          ELSE 3
        END
    `);

  const agent = agentRes.recordset[0] || null;

  return {
    loginUsername: user.Username,
    agentName: agent?.agent_name || user.Username,
    displayName: agent?.agent_name || user.Username,
    supervisor: agent?.supervisor || null,
    agentId: agent?.agent_id || null,
    agentEmail: agent?.agent_email || user.Email,
    agentType: agent?.agent_type || null,
    location: agent?.agent_location || null,
    accountType: user.AccountType,
    hasAgentRecord: Boolean(agent),
  };
}

function assertSelfOrElevated(req, targetUsername) {
  if (!req.user?.username) return false;
  const caller = req.user.username.toLowerCase();
  const target = String(targetUsername || "").trim().toLowerCase();
  if (caller === target) return true;
  const elevated = ["Super Admin", "Admin", "Manager", "Team Leader", "Auditor"];
  return elevated.includes(req.user.accountType);
}

/**
 * Resolves which dbo.briefing.username value(s) should receive an upload.
 * Agents fetch briefings by their supervisor from dbo.Agents, so uploads must
 * be stored under the team-leader username — not the logged-in superadmin.
 */
async function resolveBriefingOwnerUsernames(pool, loginUsername, teamLeaderUsername = null) {
  const login = String(loginUsername || "").trim();
  if (!login) return [];

  const userRes = await pool.request().input("login", sql.NVarChar, login).query(`
      SELECT TOP 1 Username, AccountType
      FROM dbo.Users
      WHERE LOWER(Username) = LOWER(@login)
         OR LOWER(LoginAlias) = LOWER(@login)
    `);

  const user = userRes.recordset[0];
  if (!user) return [];

  const accountType = user.AccountType || "";
  const canonicalUsername = user.Username;

  if (accountType === "Team Leader") {
    return [canonicalUsername];
  }

  const explicit = String(teamLeaderUsername || "").trim();
  if (explicit) {
    return [explicit];
  }

  if (["Super Admin", "Admin", "Manager"].includes(accountType)) {
    const supRes = await pool.request().query(`
        SELECT DISTINCT supervisor
        FROM dbo.Agents
        WHERE supervisor IS NOT NULL AND LTRIM(RTRIM(supervisor)) <> ''
      `);
    const supervisors = supRes.recordset.map((row) => row.supervisor).filter(Boolean);
    if (supervisors.length > 0) return supervisors;
  }

  return [canonicalUsername];
}

module.exports = { resolveAgentIdentity, assertSelfOrElevated, resolveBriefingOwnerUsernames };
