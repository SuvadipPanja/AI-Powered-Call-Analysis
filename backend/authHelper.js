const sql = require("./sqlClient");

async function fetchUserForLogin(pool, loginId) {
  const id = String(loginId).trim();
  if (!id) return null;

  if (/^\d+$/.test(id)) {
    const byNumericId = await pool
      .request()
      .input("userId", sql.Int, parseInt(id, 10))
      .query(`
        SELECT UserID, Username, Password, AccountType,
               SecurityQuestionType, SecurityQuestionAnswer, LoginAlias
        FROM dbo.Users
        WHERE UserID = @userId
      `);
    if (byNumericId.recordset[0]) return byNumericId.recordset[0];
  }

  const byAlias = await pool
    .request()
    .input("login", sql.NVarChar, id)
    .query(`
      SELECT UserID, Username, Password, AccountType,
             SecurityQuestionType, SecurityQuestionAnswer, LoginAlias
      FROM dbo.Users
      WHERE Username = @login COLLATE SQL_Latin1_General_CP1_CI_AS
         OR LoginAlias = @login COLLATE SQL_Latin1_General_CP1_CI_AS
    `);

  return byAlias.recordset[0] || null;
}

function getLoginIdForSession(user) {
  return user.LoginAlias || String(user.UserID);
}

async function resolveSessionUserId(pool, loginId) {
  const user = await fetchUserForLogin(pool, loginId);
  return user ? getLoginIdForSession(user) : String(loginId).trim();
}

module.exports = { fetchUserForLogin, getLoginIdForSession, resolveSessionUserId };
