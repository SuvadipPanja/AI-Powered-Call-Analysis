const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPtpQuality, ptpQualitySql } = require("../services/ptpQuality");

test("classifyPtpQuality maps Genuine secured PTP to strong", () => {
  assert.equal(classifyPtpQuality({ present: "Yes", genuineness: "Genuine" }), "strong");
  assert.equal(classifyPtpQuality({ present: "yes", genuineness: " genuine " }), "strong");
});

test("classifyPtpQuality maps non-Genuine secured PTP to weak", () => {
  assert.equal(classifyPtpQuality({ present: "Yes", genuineness: "Doubtful" }), "weak");
  assert.equal(classifyPtpQuality({ present: "Yes", genuineness: "Not Applicable" }), "weak");
  assert.equal(classifyPtpQuality({ present: "Yes", genuineness: "" }), "weak");
});

test("classifyPtpQuality ignores calls with no secured PTP", () => {
  assert.equal(classifyPtpQuality({ present: "No", genuineness: "Genuine" }), null);
  assert.equal(classifyPtpQuality({ present: "", genuineness: "Doubtful" }), null);
});

test("ptpQualitySql is parameterized-safe and alias-aware", () => {
  const strong = ptpQualitySql("CAA", "strong");
  const weak = ptpQualitySql("", "weak");
  assert.match(strong, /CAA\.AI_PTP_Present/);
  assert.match(strong, /CAA\.AI_PTP_Genuineness/);
  assert.match(strong, /'yes'/);
  assert.match(strong, /'genuine'/);
  assert.doesNotMatch(strong, /\$\{|`|\bOR\s+1=1/i);
  assert.match(weak, /AI_PTP_Present/);
  assert.doesNotMatch(weak, /CAA\./);
  assert.match(weak, /NOT/);
  assert.throws(() => ptpQualitySql("CAA", "medium"), /unsupported/i);
});
