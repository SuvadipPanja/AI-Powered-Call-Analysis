const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildQualityCacheKey,
  shouldStoreWorkbook,
  rubricKeyList,
  rememberQualityBuild,
  takeQualityBuild,
  MAX_BUFFER_BYTES,
} = require("../services/qualityReportCache");

test("quality cache key is shared by users with the same role, filters, and fingerprint", () => {
  const base = {
    username: "AdminUser",
    role: "Admin",
    fromDate: "2026-07-20",
    toDate: "2026-08-20",
    location: "All",
    tl: "All",
    callCount: 12,
    maxDate: "2026-08-19T10:00:00.123Z",
    rubricKeys: "greeting,ptp",
  };
  const a = buildQualityCacheKey(base);
  const otherUser = buildQualityCacheKey({ ...base, username: "OtherAdmin" });
  const sameSecond = buildQualityCacheKey({ ...base, maxDate: "2026-08-19T10:00:00.999Z" });
  const newCall = buildQualityCacheKey({ ...base, callCount: 13 });
  const otherRole = buildQualityCacheKey({ ...base, role: "Team Leader" });
  const same = buildQualityCacheKey(base);
  assert.equal(a, same);
  assert.equal(a, otherUser);
  assert.equal(a, sameSecond);
  assert.notEqual(a, newCall);
  assert.notEqual(a, otherRole);
  assert.equal(/Token|password/i.test(a), false);
});

test("does not store empty or oversized workbooks", () => {
  assert.equal(shouldStoreWorkbook(Buffer.alloc(0)), false);
  assert.equal(shouldStoreWorkbook(Buffer.from("xlsx")), true);
  assert.equal(shouldStoreWorkbook(Buffer.alloc(MAX_BUFFER_BYTES + 1)), false);
});

test("rubric key list ignores disabled dimensions", () => {
  assert.equal(
    rubricKeyList([
      { key: "greeting", enabled: true },
      { key: "hidden", enabled: false },
      { key: "ptp", enabled: true },
    ]),
    "greeting,ptp",
  );
});

test("concurrent quality builds share one in-flight promise", async () => {
  let builds = 0;
  const work = rememberQualityBuild("same-key", (async () => {
    builds += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return Buffer.from("xlsx");
  })());
  const other = takeQualityBuild("same-key");
  assert.equal(other, work);
  const [a, b] = await Promise.all([work, other]);
  assert.equal(builds, 1);
  assert.equal(a.toString(), "xlsx");
  assert.equal(b.toString(), "xlsx");
  assert.equal(takeQualityBuild("same-key"), null);
});
