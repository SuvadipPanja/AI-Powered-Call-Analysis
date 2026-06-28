require("dotenv").config();
const sql = require("mssql");
const { connectToDatabase } = require("./dbConnection");

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || "1433", 10),
  database: process.env.DB_DATABASE,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
};

if (process.env.DB_USE_WINDOWS_AUTH === "true") {
  config.options.trustedConnection = true;
} else {
  config.user = process.env.DB_USER;
  config.password = process.env.DB_PASSWORD;
}

if (!config.server || !config.database) {
  console.error("Set DB_SERVER and DB_DATABASE in backend/.env before running testConnection.js");
  process.exit(1);
}

connectToDatabase()
  .then(() => {
    console.log("Database connected successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });
