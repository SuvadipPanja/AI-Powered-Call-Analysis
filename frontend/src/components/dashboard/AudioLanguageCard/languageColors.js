/** Stable language colors for the language-mix donut. Unknown stays muted. */

const PALETTE = {
  hindi: { light: "#ABD0FA", face: "#8DB4F6", deep: "#7F9EF1", wall: "#4963BB", dot: ["#A8BAF0", "#657FE8", "#5266DB"] },
  marathi: { light: "#C4A8F6", face: "#AA8BF1", deep: "#9A79EA", wall: "#6A4DC2", dot: ["#9575E5", "#8459E6", "#6946D0"] },
  bengali: { light: "#C8E9FA", face: "#ADDCF7", deep: "#97CDEE", wall: "#5A9DC0", dot: ["#A8D4DB", "#6FB0BA", "#5A919A"] },
  english: { light: "#C9F2F4", face: "#AEE9EE", deep: "#97DCE0", wall: "#58A3A6", dot: ["#A5CBBB", "#82AD9C", "#5D9578"] },
  kannada: { light: "#CFAAF7", face: "#B98AF1", deep: "#A676EA", wall: "#7358C6", dot: ["#BEB5E3", "#8C75D4", "#6148B7"] },
  tamil: { light: "#9DB5F0", face: "#7A96E3", deep: "#6482D1", wall: "#3C4F96", dot: ["#92BAEF", "#7095DD", "#587EC9"] },
  telugu: { light: "#B5CCF7", face: "#94B4F0", deep: "#7C9FE6", wall: "#506FBF", dot: ["#A6C0EE", "#6D8FDF", "#5875C4"] },
  gujarati: { light: "#F3C9DC", face: "#E9ACCB", deep: "#DC93B8", wall: "#A8628A", dot: ["#F0C2D7", "#D98AB0", "#B96A92"] },
};

const FALLBACK = { light: "#D2DAE5", face: "#B7C3D3", deep: "#A0AEC2", wall: "#6F7F95", dot: ["#C3CDD9", "#7C8EA3", "#65778C"] };

export function languageDonutPalette(name) {
  const key = String(name || "").trim().toLowerCase();
  if (key === "unknown" || key === "other languages" || key === "") return FALLBACK;
  return PALETTE[key] || FALLBACK;
}

export function languageDonutColor(name) {
  return languageDonutPalette(name).dot[1];
}

/** Glossy sphere fill for a legend dot. */
export function languageDotBackground(name) {
  const [light, base, deep] = languageDonutPalette(name).dot;
  return `radial-gradient(circle at 35% 30%, ${light} 0%, ${base} 55%, ${deep} 100%)`;
}
