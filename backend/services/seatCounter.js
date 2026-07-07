/**
 * Sprint 8 — atomic concurrent-user (seat) enforcement at login.
 *
 * check-login-availability is advisory only; two clients can pass it and both
 * INSERT into ActiveSessions. This module acquires a seat inside a single DB
 * transaction with UPDLOCK/HOLDLOCK so the cap cannot be exceeded.
 */

function isLicenseRecoveryMode() {
  return !global.licensePayload || global.licenseState === "expired";
}

function getMaxConcurrentUsers() {
  if (isLicenseRecoveryMode()) return 0;
  const raw =
    global.licensePayload.users ??
    global.licensePayload.limits?.maxConcurrentUsers ??
    0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function insertSessionRecords(transaction, sqlLib, { userId, username, userType, sessionToken }) {
  const logReq = new sqlLib.Request(transaction);
  const insertLog = await logReq
    .input("UserID", sqlLib.NVarChar, userId)
    .input("Username", sqlLib.NVarChar, username)
    .input("UserType", sqlLib.NVarChar, userType)
    .input("LoginTime", sqlLib.DateTime, new Date())
    .query(`
      INSERT INTO UserSessionLog (UserID, Username, UserType, LoginTime)
      OUTPUT INSERTED.LogID
      VALUES (@UserID, @Username, @UserType, @LoginTime);
    `);
  const logId = insertLog.recordset[0].LogID;

  const sessReq = new sqlLib.Request(transaction);
  await sessReq
    .input("UserID", sqlLib.NVarChar, userId)
    .input("Username", sqlLib.NVarChar, username)
    .input("LogID", sqlLib.Int, logId)
    .input("LoginTime", sqlLib.DateTime, new Date())
    .input("Token", sqlLib.NVarChar, sessionToken)
    .query(`
      INSERT INTO ActiveSessions (UserID, Username, LogID, LoginTime, IsActive, Token)
      VALUES (@UserID, @Username, @LogID, @LoginTime, 1, @Token);
    `);

  return { logId, sessionToken };
}

/**
 * Acquire a seat and create session rows atomically.
 * @returns {Promise<{ ok: true, logId: number, sessionToken: string } | { ok: false, code: string, message: string, activeCount?: number, maxUsers?: number }>}
 */
async function acquireSessionSeat(pool, sqlLib, crypto, { userId, username, userType }) {
  const sessionToken = crypto.randomBytes(32).toString("hex");

  if (isLicenseRecoveryMode()) {
    const transaction = new sqlLib.Transaction(pool);
    await transaction.begin();
    try {
      const result = await insertSessionRecords(transaction, sqlLib, {
        userId,
        username,
        userType,
        sessionToken,
      });
      await transaction.commit();
      return { ok: true, ...result };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  const maxUsers = getMaxConcurrentUsers();
  if (!maxUsers) {
    const transaction = new sqlLib.Transaction(pool);
    await transaction.begin();
    try {
      const result = await insertSessionRecords(transaction, sqlLib, {
        userId,
        username,
        userType,
        sessionToken,
      });
      await transaction.commit();
      return { ok: true, ...result };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  const transaction = new sqlLib.Transaction(pool);
  await transaction.begin();
  try {
    const countReq = new sqlLib.Request(transaction);
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS cnt
      FROM ActiveSessions WITH (UPDLOCK, HOLDLOCK)
      WHERE IsActive = 1
    `);
    const activeCount = countRes.recordset[0].cnt;
    if (activeCount >= maxUsers) {
      await transaction.rollback();
      return {
        ok: false,
        code: "SEAT_LIMIT",
        message: `Maximum login count (${maxUsers}) reached as per the license.`,
        activeCount,
        maxUsers,
      };
    }

    const result = await insertSessionRecords(transaction, sqlLib, {
      userId,
      username,
      userType,
      sessionToken,
    });
    await transaction.commit();
    return { ok: true, ...result, activeCount: activeCount + 1, maxUsers };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  isLicenseRecoveryMode,
  getMaxConcurrentUsers,
  acquireSessionSeat,
};
