/** UI prefs kept when auth storage is cleared (sidebar, theme, branding). */
export const SIDEBAR_COLLAPSED_KEY = "app-sidebar-collapsed";
export const THEME_KEY = "app-theme";
export const BRANDING_CACHE_KEY = "appBranding";

const PRESERVED_KEYS = [SIDEBAR_COLLAPSED_KEY, THEME_KEY, BRANDING_CACHE_KEY];

export function preserveUiPreferences() {
  const prefs = {};
  try {
    for (const key of PRESERVED_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) prefs[key] = value;
    }
  } catch {
    /* ignore */
  }
  return prefs;
}

/** Clear auth/session keys but keep sidebar collapse + theme. */
export function clearAuthStorage() {
  const prefs = preserveUiPreferences();
  try {
    localStorage.clear();
    for (const [key, value] of Object.entries(prefs)) {
      localStorage.setItem(key, value);
    }
  } catch {
    /* ignore */
  }
}

export function readSidebarCollapsed() {
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true") return true;
    const legacy = sessionStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (legacy === "true") {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "true");
      sessionStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(value) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  } catch {
    /* ignore */
  }
}
