// envConfig.js
// No need to import dotenv, fs, or path since we're in a browser environment
// create-react-app automatically loads environment variables from .env files

// Export configuration using process.env directly
const config = {
  apiBaseUrl: process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000',
  logDir: process.env.REACT_APP_LOG_DIR || './logs', // For reference only; we won't use this in the browser
  env: process.env.REACT_APP_ENV || 'development',
  loginBackgroundUrl: process.env.REACT_APP_LOGIN_BACKGROUND_URL || '/images/background.jpg',
  wsUrl: process.env.REACT_APP_WS_URL || 'ws://localhost:5000' // Added for WebSocket URL
  // NOTE: The license secret is intentionally NOT exposed to the frontend.
  // License validation is performed entirely server-side.
};

// Validate required environment variables
if (!config.apiBaseUrl || !config.wsUrl) {
  throw new Error("Environment variables REACT_APP_API_BASE_URL and REACT_APP_WS_URL must be defined in .env");
}

// Note: We can't create directories in the browser, so we skip the ensureDirectories function
// The logs directory can be created on the backend if needed, or during build time in a Node.js environment

export default config;