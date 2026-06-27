/** Derive 1–2 letter initials from a username or display name. */
export function usernameInitials(name) {
  const raw = String(name || "").trim();
  if (!raw) return "?";
  const parts = raw.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  return raw.slice(0, 2).toUpperCase();
}

/** Stable hue (0–360) from a string — for default avatar backgrounds. */
export function usernameHue(name) {
  let hash = 0;
  const s = String(name || "user");
  for (let i = 0; i < s.length; i += 1) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}
