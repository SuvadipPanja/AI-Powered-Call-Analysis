/**
 * Role-based access helpers for Express routes (expects req.user from authGate).
 */

const AGENT_MANAGER_ROLES = ["Super Admin", "Admin", "Manager"];

function deny(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function requireAccountTypes(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return function requireAccountTypesMiddleware(req, res, next) {
    if (!req.user?.username) {
      return deny(res, 401, "Authentication required.");
    }
    if (req.user.isService) {
      return deny(res, 403, "Service accounts cannot perform this action.");
    }
    if (!allowed.has(req.user.accountType)) {
      return deny(res, 403, "You do not have permission to perform this action.");
    }
    return next();
  };
}

function requireSuperAdmin(req, res, next) {
  return requireAccountTypes("Super Admin")(req, res, next);
}

module.exports = {
  AGENT_MANAGER_ROLES,
  requireAccountTypes,
  requireSuperAdmin,
};
