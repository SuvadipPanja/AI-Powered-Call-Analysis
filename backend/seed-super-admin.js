require("dotenv").config();
const bcrypt = require("bcrypt");
const sql = require("./sqlClient");

(async () => {
  const hash = await bcrypt.hash("SuperAdmin@2026", 10);
  const sqHash = await bcrypt.hash("blue", 10);
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      trustedConnection: true,
    },
  });

  const existing = await pool
    .request()
    .input("alias", sql.NVarChar, "SUPER001")
    .query("SELECT UserID FROM dbo.Users WHERE LoginAlias = @alias OR Username = 'superadmin'");

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input("hash", sql.NVarChar, hash)
      .input("sqHash", sql.NVarChar, sqHash)
      .input("alias", sql.NVarChar, "SUPER001")
      .query(`
        UPDATE dbo.Users
        SET Password = @hash,
            LoginAlias = @alias,
            AccountType = 'Super Admin',
            SecurityQuestionType = 'Favorite color',
            SecurityQuestionAnswer = @sqHash
        WHERE LoginAlias = @alias OR Username = 'superadmin'
      `);
    console.log("Updated emergency superadmin (SUPER001).");
  } else {
    await pool
      .request()
      .input("username", sql.NVarChar, "superadmin")
      .input("hash", sql.NVarChar, hash)
      .input("sqHash", sql.NVarChar, sqHash)
      .input("alias", sql.NVarChar, "SUPER001")
      .input("email", sql.NVarChar, "superadmin@local")
      .query(`
        INSERT INTO dbo.Users (
          Username, Password, Email, AccountType,
          SecurityQuestionType, SecurityQuestionAnswer, LoginAlias
        )
        VALUES (
          @username, @hash, @email, 'Super Admin',
          'Favorite color', @sqHash, @alias
        )
      `);
    console.log("Created emergency superadmin (SUPER001).");
  }

  await pool.close();
})();
