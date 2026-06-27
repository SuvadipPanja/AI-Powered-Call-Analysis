// License configuration.
//
// SECURITY: Secrets must NOT be hardcoded. Values are read from environment
// variables (see .env / .env.example). The process fails fast with a clear
// error if a required secret is missing.
require("dotenv").config();

const secretKey = process.env.LICENSE_SECRET_KEY;
if (!secretKey) {
  throw new Error(
    "LICENSE_SECRET_KEY is not set. Define it in the backend .env before starting the server."
  );
}

module.exports = {
  secretKey,
  // The active license key is stored in the database / license file, not here.
  // Provide a fallback via env only if your deployment needs a static key.
  licenseKey: process.env.LICENSE_KEY || "",
};
