const path = require("path");

/** Project root — avoids fragile `Project log` env key with a space. */
function getProjectRoot() {
  return (
    process.env.PROJECT_ROOT ||
    process.env["Project log"] ||
    path.resolve(__dirname, "..")
  );
}

/** Expand `${Project log}` placeholders in .env path values. */
function resolveProjectPath(value) {
  if (!value) return value;
  const root = getProjectRoot();
  return String(value).replace(/\$\{Project log\}/g, root);
}

function isMissingDbObjectError(error) {
  const msg = String(error?.message || error || "");
  return (
    msg.includes("Invalid object name") ||
    msg.includes("Invalid column name") ||
    msg.includes("does not exist")
  );
}

module.exports = {
  getProjectRoot,
  resolveProjectPath,
  isMissingDbObjectError,
};
