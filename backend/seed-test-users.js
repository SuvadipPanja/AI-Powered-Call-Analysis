require("dotenv").config();
const bcrypt = require("bcrypt");
const sql = require("./sqlClient");

const SALT_ROUNDS = 10;

const TEST_USERS = [
  {
    loginAlias: "SUPER001",
    username: "superadmin",
    plainPassword: "SuperAdmin@2026",
    email: "superadmin@local",
    accountType: "Super Admin",
    securityQuestionType: "Favorite color",
    securityQuestionAnswer: "Blue",
  },
  {
    loginAlias: "TL001",
    username: "teamlead1",
    plainPassword: "TeamLead@2026",
    email: "teamlead1@local",
    accountType: "Team Leader",
    securityQuestionType: "Favorite color",
    securityQuestionAnswer: "Red",
  },
  {
    loginAlias: "AGT001",
    username: "agent1",
    plainPassword: "Agent@2026",
    email: "agent1@local",
    accountType: "Agent",
    securityQuestionType: "Favorite game",
    securityQuestionAnswer: "Chess",
  },
  {
    loginAlias: "MGR001",
    username: "manager1",
    plainPassword: "Manager@2026",
    email: "manager1@local",
    accountType: "Manager",
    securityQuestionType: "First pet's name",
    securityQuestionAnswer: "Buddy",
  },
];

(async () => {
  let pool;
  try {
    const config = {
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      port: parseInt(process.env.DB_PORT) || 1433,
      options: {
        encrypt: process.env.DB_ENCRYPT === "true",
        trustServerCertificate:
          process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
      },
    };
    if (process.env.DB_USE_WINDOWS_AUTH === "true") {
      config.options.trustedConnection = true;
    } else {
      config.user = process.env.DB_USER;
      config.password = process.env.DB_PASSWORD;
    }

    pool = await sql.connect(config);
    console.log("[seed] Connected to database.");

    for (const u of TEST_USERS) {
      const hash = await bcrypt.hash(u.plainPassword, SALT_ROUNDS);
      const sqHash = await bcrypt.hash(u.securityQuestionAnswer.trim().toLowerCase(), SALT_ROUNDS);

      const existing = await pool
        .request()
        .input("alias", sql.NVarChar, u.loginAlias)
        .input("uname", sql.NVarChar, u.username)
        .query(
          "SELECT UserID FROM dbo.Users WHERE LoginAlias = @alias OR Username = @uname"
        );

      if (existing.recordset.length > 0) {
        await pool
          .request()
          .input("hash", sql.NVarChar, hash)
          .input("alias", sql.NVarChar, u.loginAlias)
          .input("uname", sql.NVarChar, u.username)
          .input("email", sql.NVarChar, u.email)
          .input("accountType", sql.NVarChar, u.accountType)
          .input("sqType", sql.NVarChar, u.securityQuestionType)
          .input("sqAnswer", sql.NVarChar, sqHash)
          .query(`
            UPDATE dbo.Users
            SET Password            = @hash,
                LoginAlias          = @alias,
                Email               = @email,
                AccountType         = @accountType,
                SecurityQuestionType   = @sqType,
                SecurityQuestionAnswer = @sqAnswer
            WHERE LoginAlias = @alias OR Username = @uname
          `);
        console.log(`[seed] Updated ${u.loginAlias} (${u.username}).`);
      } else {
        await pool
          .request()
          .input("uname", sql.NVarChar, u.username)
          .input("hash", sql.NVarChar, hash)
          .input("alias", sql.NVarChar, u.loginAlias)
          .input("email", sql.NVarChar, u.email)
          .input("accountType", sql.NVarChar, u.accountType)
          .input("sqType", sql.NVarChar, u.securityQuestionType)
          .input("sqAnswer", sql.NVarChar, sqHash)
          .query(`
            INSERT INTO dbo.Users (
              Username, Password, Email, AccountType,
              SecurityQuestionType, SecurityQuestionAnswer, LoginAlias
            )
            VALUES (
              @uname, @hash, @email, @accountType,
              @sqType, @sqAnswer, @alias
            )
          `);
        console.log(`[seed] Created ${u.loginAlias} (${u.username}).`);
      }
    }

    console.log("\n[seed] All test users seeded successfully.");
    console.log("========================================");

    // Link test agent user to dbo.Agents so dashboard/briefing resolve correctly.
    const agentUser = TEST_USERS.find((u) => u.accountType === "Agent");
    if (agentUser) {
      const tlUser = TEST_USERS.find((u) => u.accountType === "Team Leader");
      const supervisorName = tlUser?.username || "teamlead1";
      const existingAgent = await pool
        .request()
        .input("email", sql.NVarChar, agentUser.email)
        .query("SELECT agent_id FROM dbo.Agents WHERE LOWER(agent_email) = LOWER(@email)");

      if (existingAgent.recordset.length > 0) {
        await pool
          .request()
          .input("email", sql.NVarChar, agentUser.email)
          .input("agentName", sql.NVarChar, agentUser.username)
          .input("supervisor", sql.NVarChar, supervisorName)
          .query(`
            UPDATE dbo.Agents
            SET agent_name = @agentName,
                supervisor = @supervisor,
                is_active = 1
            WHERE LOWER(agent_email) = LOWER(@email)
          `);
        console.log(`[seed] Updated Agents row for ${agentUser.username}.`);
      } else {
        await pool
          .request()
          .input("agent_id", sql.NVarChar, agentUser.loginAlias)
          .input("agent_name", sql.NVarChar, agentUser.username)
          .input("agent_email", sql.NVarChar, agentUser.email)
          .input("agent_mobile", sql.NVarChar, "9000000001")
          .input("supervisor", sql.NVarChar, supervisorName)
          .input("agent_type", sql.NVarChar, "inbound")
          .query(`
            INSERT INTO dbo.Agents (
              agent_id, agent_name, agent_email, agent_mobile,
              supervisor, agent_type, is_active, agent_creation_date
            )
            VALUES (
              @agent_id, @agent_name, @agent_email, @agent_mobile,
              @supervisor, @agent_type, 1, GETDATE()
            )
          `);
        console.log(`[seed] Created Agents row for ${agentUser.username}.`);
      }
    }

    console.log(" Login ID  | Username   | Password         | Role         | Security Q         | Answer");
    console.log("-----------|------------|------------------|--------------|--------------------|-------");
    for (const u of TEST_USERS) {
      console.log(
        ` ${u.loginAlias.padEnd(9)} | ${u.username.padEnd(10)} | ${u.plainPassword.padEnd(16)} | ${u.accountType.padEnd(12)} | ${u.securityQuestionType.padEnd(18)} | ${u.securityQuestionAnswer}`
      );
    }
    console.log("========================================");
  } catch (err) {
    console.error("[seed] Error:", err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
})();
