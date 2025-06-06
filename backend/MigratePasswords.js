require('dotenv').config(); // Load environment variables
const sql = require("mssql");
const bcrypt = require("bcrypt");

// Database configuration (update with your actual values)
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

async function migratePasswords() {
  try {
    const pool = await sql.connect(config);
    console.log("Connected to database.");

    // Fetch all users with their current passwords
    const result = await pool.request().query("SELECT UserID, Password FROM dbo.Users");
    const users = result.recordset;

    console.log(`Found ${users.length} users to migrate.`);

    for (const user of users) {
      const userId = user.UserID;
      const plainPassword = user.Password;

      // Check if the password is already hashed (starts with $2b$)
      if (plainPassword.startsWith('$2b$')) {
        console.log(`UserID ${userId}: Password already hashed, skipping.`);
        continue;
      }

      // Hash the password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);
      console.log(`UserID ${userId}: Hashed password - ${hashedPassword}`);

      // Update the password in the database
      await pool.request()
        .input('UserID', sql.Int, userId)
        .input('Password', sql.VarChar(255), hashedPassword)
        .query("UPDATE dbo.Users SET Password = @Password WHERE UserID = @UserID");

      console.log(`UserID ${userId}: Password updated successfully.`);
    }

    console.log("Password migration completed successfully.");
    await pool.close();
  } catch (error) {
    console.error("Error during password migration:", error);
  }
}

migratePasswords();