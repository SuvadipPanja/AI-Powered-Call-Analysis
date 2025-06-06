require('dotenv').config();
const sql = require("mssql");

// Database Configuration using environment variables
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_DATABASE,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
};

/**
 * We store a single pool so we don't reconnect each time
 */
let pool = null;

/**
 * getPool
 * Creates or reuses a single connection pool to the MSSQL database.
 */
async function getPool() {
  if (!pool) {
    try {
      pool = await sql.connect(config);
      console.log("[DB] Connection pool created successfully.");
    } catch (err) {
      console.error("[DB] Error connecting to MSSQL:", err);
      throw err;
    }
  }
  return pool;
}

module.exports = { getPool, sql };