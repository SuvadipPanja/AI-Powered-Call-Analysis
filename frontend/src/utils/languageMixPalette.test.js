// frontend/src/utils/languageMixPalette.test.js
import {
  LANGUAGE_COLOR_TOKENS,
  LANGUAGE_PRIORITY,
  UNKNOWN_LANGUAGE_TOKEN,
  LANGUAGE_PALETTE_FALLBACK_HEX,
  languageMixColors,
} from "./languageMixPalette";

describe("languageMixPalette", () => {
  it("sources every color from the existing --viz-* data-viz tokens", () => {
    expect(LANGUAGE_COLOR_TOKENS).toHaveLength(8);
    LANGUAGE_COLOR_TOKENS.forEach((tok) => {
      expect(tok).toMatch(/^--viz-[1-8]$/);
    });
  });

  it("curates stable colors for the common ICICI HFC languages", () => {
    expect(LANGUAGE_PRIORITY["hindi"]).toBe(0);
    expect(LANGUAGE_PRIORITY["marathi"]).toBe(1);
    expect(LANGUAGE_PRIORITY["bengali"]).toBe(2);
    expect(LANGUAGE_PRIORITY["kannada"]).toBe(3);
    expect(LANGUAGE_PRIORITY["tamil"]).toBe(4);
  });

  it("resolves a known language to its curated var(--viz-N) token", () => {
    const [hindi] = languageMixColors(["Hindi"]);
    expect(hindi).toBe(`var(${LANGUAGE_COLOR_TOKENS[0]}, ${LANGUAGE_PALETTE_FALLBACK_HEX[0]})`);
  });

  it("keeps a language's color stable regardless of row order", () => {
    const [marathiFirst] = languageMixColors(["Marathi", "Hindi"]);
    const [hindiFirst] = languageMixColors(["Hindi", "Marathi"]);
    expect(marathiFirst).toBe(`var(${LANGUAGE_COLOR_TOKENS[1]}, ${LANGUAGE_PALETTE_FALLBACK_HEX[1]})`);
    expect(hindiFirst).toBe(`var(${LANGUAGE_COLOR_TOKENS[0]}, ${LANGUAGE_PALETTE_FALLBACK_HEX[0]})`);
  });

  it("uses the muted neutral token for the Unknown bucket", () => {
    const [unknown] = languageMixColors(["Unknown"]);
    expect(unknown).toBe(`var(${UNKNOWN_LANGUAGE_TOKEN}, #6b6560)`);
  });

  it("falls back to the next free --viz-* index for unlisted languages", () => {
    const colors = languageMixColors(["Hindi", "Odia", "Assamese"]);
    expect(colors[1]).toBe(`var(${LANGUAGE_COLOR_TOKENS[1]}, ${LANGUAGE_PALETTE_FALLBACK_HEX[1]})`);
    expect(colors[2]).toBe(`var(${LANGUAGE_COLOR_TOKENS[2]}, ${LANGUAGE_PALETTE_FALLBACK_HEX[2]})`);
  });

  it("never emits a hardcoded reference-image hex value", () => {
    const colors = languageMixColors(["Hindi", "Marathi", "Bengali", "Kannada", "Tamil"]);
    const referenceHex = ["#7dd3fc", "#0f766e", "#86efac", "#fbbf24", "#fb7185"];
    colors.forEach((c) => {
      referenceHex.forEach((bad) => expect(c).not.toContain(bad));
    });
  });
});
