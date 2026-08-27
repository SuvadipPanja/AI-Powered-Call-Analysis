function classifyPtpQuality({ present, genuineness } = {}) {
  if (String(present || "").trim().toLowerCase() !== "yes") return null;
  return String(genuineness || "").trim().toLowerCase() === "genuine" ? "strong" : "weak";
}

function ptpQualitySql(alias, quality) {
  const prefix = alias ? `${alias}.` : "";
  const present = `LOWER(LTRIM(RTRIM(COALESCE(${prefix}AI_PTP_Present, '')))) = 'yes'`;
  const genuine = `LOWER(LTRIM(RTRIM(COALESCE(${prefix}AI_PTP_Genuineness, '')))) = 'genuine'`;
  if (quality === "strong") return `${present} AND ${genuine}`;
  if (quality === "weak") return `${present} AND NOT (${genuine})`;
  throw new Error("unsupported PTP quality");
}

module.exports = { classifyPtpQuality, ptpQualitySql };
