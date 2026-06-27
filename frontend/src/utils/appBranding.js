import { useState, useEffect, useCallback } from 'react';
import config from './envConfig';

const CACHE_KEY = 'appBranding';
export const DEFAULT_APP_NAME = 'AI-Powered Call Analysis';
const DEFAULT_NAME = DEFAULT_APP_NAME;
export const BRANDING_EVENT = 'app-branding-updated';

export function applyBrandingToDocument({ appName, logoUrl } = {}) {
  if (appName) document.title = appName;
  if (logoUrl) {
    const cacheBusted = logoUrl.includes('?') ? logoUrl : `${logoUrl}?v=${Date.now()}`;
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = cacheBusted;
    let apple = document.querySelector("link[rel='apple-touch-icon']");
    if (!apple) {
      apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      document.head.appendChild(apple);
    }
    apple.href = cacheBusted;
  }
}

export function cacheBranding(branding) {
  if (!branding) return;
  localStorage.setItem(CACHE_KEY, JSON.stringify(branding));
}

export function getCachedBranding() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function notifyBrandingUpdated(branding) {
  cacheBranding(branding);
  applyBrandingToDocument(branding);
  window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: branding }));
}

export async function fetchPublicBranding() {
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/public/branding`);
    const data = await res.json();
    if (data.success) {
      const branding = {
        appName: data.appName || DEFAULT_NAME,
        logoUrl: data.logoUrl || '',
      };
      notifyBrandingUpdated(branding);
      return branding;
    }
  } catch {
    /* offline / server down */
  }
  return getCachedBranding();
}

/** React hook — app name + logo for shell, login, favicon. */
export function useAppBranding() {
  const cached = getCachedBranding();
  const [branding, setBranding] = useState({
    appName: cached?.appName || DEFAULT_NAME,
    logoUrl: cached?.logoUrl || '',
  });

  const refresh = useCallback(async () => {
    const next = await fetchPublicBranding();
    if (next) setBranding(next);
  }, []);

  useEffect(() => {
    refresh();
    const onUpdate = (e) => {
      if (e.detail) setBranding(e.detail);
    };
    window.addEventListener(BRANDING_EVENT, onUpdate);
    return () => window.removeEventListener(BRANDING_EVENT, onUpdate);
  }, [refresh]);

  return { ...branding, refresh };
}

/**
 * Hook to keep document.title in sync with branding + current page label.
 * Pass appName from an existing useAppBranding() call to avoid duplicate fetches.
 * Usage: useDocumentTitle("Dashboard", appName) → "Dashboard | MyAppName"
 */
export function useDocumentTitle(pageTitle, appName) {
  const resolvedName = appName || getCachedBranding()?.appName || DEFAULT_NAME;

  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} | ${resolvedName}` : resolvedName;
  }, [pageTitle, resolvedName]);
}
