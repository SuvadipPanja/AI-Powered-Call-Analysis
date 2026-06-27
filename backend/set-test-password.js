require("dotenv").config();
const bcrypt = require("bcrypt");
const sql = require("./sqlClient");

(async () => {
  const password = process.env.TEST_PASSWORD;
  const username = process.env.TEST_USERNAME || "admin";
  if (!password) {
    console.error("Set TEST_PASSWORD (and optionally TEST_USERNAME) before running this script.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      trustedConnection: true,
    },
  });

  await pool
    .request()
    .input("hash", sql.NVarChar, hash)
    .input("username", sql.NVarChar, username)
    .query("UPDATE dbo.Users SET Password = @hash WHERE Username = @username");

  const result = await pool
    .request()
    .input("username", sql.NVarChar, username)
    .query("SELECT Username, Password FROM dbo.Users WHERE Username = @username");

  const stored = result.recordset[0].Password;
  console.log("Updated admin password. Match:", await bcrypt.compare(password, stored));
  await pool.close();
})();
