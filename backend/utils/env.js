// utils/env.js
const path = require('path');

/**
 * Resolves a path by replacing ${PROJECT_BASE_DIR} with the actual base directory.
 * Ensures cross-platform compatibility by normalizing paths.
 * @param {string} envPath - The path from the .env file
 * @returns {string} - The resolved path
 */
function resolvePath(envPath) {
  if (!process.env.PROJECT_BASE_DIR) {
    throw new Error('PROJECT_BASE_DIR environment variable is not set.');
  }
  // Replace ${PROJECT_BASE_DIR} with the actual value
  const resolvedPath = envPath.replace('${PROJECT_BASE_DIR}', process.env.PROJECT_BASE_DIR);
  // Normalize the path for cross-platform compatibility (converts / to \ on Windows)
  return path.normalize(resolvedPath);
}

/**
 * Validates that all required environment variables are set.
 * @param {string[]} requiredVars - Array of required environment variable names
 */
function validateEnv(requiredVars) {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

module.exports = { resolvePath, validateEnv };