require("dotenv").config();
const sql = require("mssql/msnodesqlv8");

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    trustedConnection: true,
  },
};

(async () => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT @@SERVERNAME AS serverName, COUNT(*) AS users FROM dbo.Users");
    console.log("OK", result.recordset[0]);
    await pool.close();
    process.exit(0);
  } catch (error) {
    console.error("FAIL", error.message);
    process.exit(1);
  }
})();
