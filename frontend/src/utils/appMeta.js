/** Shared app branding for footers */
export const APP_VERSION = "v4.2.4";

export function getAppFooter(appName) {
  const name = appName || "Call Analysis";
  return `© 2024-2026 ${name} · ${APP_VERSION} · Developed by Suvadip Panja`;
}

export const APP_FOOTER = getAppFooter();
