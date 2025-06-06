require('dotenv').config();
const sql = require('mssql');

// Database config using environment variables
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

async function connectToDatabase() {
  try {
    // Attempt to connect
    const pool = await sql.connect(config);
    return pool;
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}

module.exports = { connectToDatabase };