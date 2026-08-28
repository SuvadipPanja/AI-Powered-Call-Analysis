/**
 * Curated, token-driven palette for the "Language mix" dashboard card.
 * Colors are sourced entirely from the existing --viz-* data-viz tokens in
 * frontend/src/index.css (theme-aware: dark default + [data-theme="light"]).
 * No hardcoded reference-image colors — the hex values below are canvas
 * fallbacks only, because Chart.js fillStyle cannot paint CSS var(...) strings.
 */

export const LANGUAGE_COLOR_TOKENS = [
  "--viz-1", "--viz-2", "--viz-3", "--viz-4",
  "--viz-5", "--viz-6", "--viz-7", "--viz-8",
];

// Dark-theme resolved values (dark is the default theme). Used as the fallback
// inside each var(--token, fallback) so the canvas never paints black if a
// token is missing.
export const LANGUAGE_PALETTE_FALLBACK_HEX = [
  "#14b8a6", "#f59e0b", "#34c759", "#ca8a04",
  "#f0635a", "#38bdf8", "#0d9488", "#fb923c",
];

// Muted neutral for the Unknown bucket — never competes with real languages.
export const UNKNOWN_LANGUAGE_TOKEN = "--text-faint-solid";
const UNKNOWN_FALLBACK_HEX = "#6b6560";

// Stable, curated mapping for the common ICICI HFC collections languages so a
// language keeps its color across periods even when its rank changes.
export const LANGUAGE_PRIORITY = {
  hindi: 0, marathi: 1, bengali: 2, kannada: 3,
  tamil: 4, telugu: 5, gujarati: 6, english: 7,
};

function tokenVar(tokenIndex, fallbackHex) {
  return `var(${LANGUAGE_COLOR_TOKENS[tokenIndex]}, ${fallbackHex})`;
}

/**
 * Resolve one `var(--viz-N, fallback)` color per label.
 * - "Unknown" (any case) always gets the muted neutral token.
 * - Curated languages get their stable token index.
 * - Unlisted languages take the next free token index by rank (skipping
 *   indices already claimed by curated languages in this batch).
 * @param {string[]} labels
 * @returns {string[]}
 */
export function languageMixColors(labels) {
  const usedByCurated = new Set();
  const result = new Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) {
    const name = String(labels[i] || "").trim();
    const key = name.toLowerCase();
    if (key === "unknown" || key === "") {
      result[i] = `var(${UNKNOWN_LANGUAGE_TOKEN}, ${UNKNOWN_FALLBACK_HEX})`;
      continue;
    }
    const curated = LANGUAGE_PRIORITY[key];
    if (curated != null) {
      usedByCurated.add(curated);
      result[i] = tokenVar(curated, LANGUAGE_PALETTE_FALLBACK_HEX[curated]);
    }
  }
  let fallbackCursor = 0;
  for (let i = 0; i < labels.length; i += 1) {
    if (result[i]) continue;
    while (usedByCurated.has(fallbackCursor) && fallbackCursor < LANGUAGE_COLOR_TOKENS.length) {
      fallbackCursor += 1;
    }
    const idx = fallbackCursor < LANGUAGE_COLOR_TOKENS.length ? fallbackCursor : 0;
    usedByCurated.add(idx);
    result[i] = tokenVar(idx, LANGUAGE_PALETTE_FALLBACK_HEX[idx]);
    fallbackCursor += 1;
  }
  return result;
}
