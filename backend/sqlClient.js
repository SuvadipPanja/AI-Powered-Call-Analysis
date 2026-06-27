require("dotenv").config();

module.exports = process.env.DB_USE_WINDOWS_AUTH === "true"
  ? require("mssql/msnodesqlv8")
  : require("mssql");
