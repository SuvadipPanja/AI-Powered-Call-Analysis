const test = require("node:test");
const assert = require("node:assert/strict");
const { queryTopScorerForWeek } = require("../services/reportHelpers");

/**
 * Fake mssql pool. `behaviors` is one entry per query attempt: an Error to
 * throw, or an array to use as the recordset. Rebinding a parameter throws the
 * same message mssql uses, so a duplicate bind fails the test loudly.
 */
function fakePool(behaviors) {
  let attempt = 0;
  const queries = [];
  return {
    queries,
    request() {
      const req = {
        parameters: {},
        input(name, type, value) {
          if (Object.prototype.hasOwnProperty.call(req.parameters, name)) {
            throw new Error(
              `The parameter name ${name} has already been declared. Parameter names must be unique`,
            );
          }
          req.parameters[name] = { name, type, value };
          return req;
        },
        async query(text) {
          queries.push(text);
          const behavior = behaviors[attempt];
          attempt += 1;
          if (behavior instanceof Error) throw behavior;
          return { recordset: behavior || [] };
        },
      };
      return req;
    },
  };
}

const params = {
  fromDateStr: "2026-07-27",
  toDateStr: "2026-08-27",
  location: "All",
  tl: "All",
  callType: "All",
  agent: "All",
};

test("returns the first scorer without running later fallbacks", async () => {
  const pool = fakePool([[{ agentName: "Priya", avgScore: 88.4, callCount: 12 }]]);
  const result = await queryTopScorerForWeek(pool, "outbound", params);
  assert.deepEqual(result, { agentName: "Priya", avgScore: 88.4, callCount: 12 });
  assert.equal(pool.queries.length, 1);
});

test("returns null instead of throwing when every fallback fails", async () => {
  const pool = fakePool([
    new Error("Conversion failed when converting the nvarchar value 'N/A' to data type float"),
    new Error("Invalid column name 'Overall_Scoring'"),
    new Error("Conversion failed when converting the nvarchar value '' to data type float"),
  ]);
  assert.equal(await queryTopScorerForWeek(pool, "outbound", params), null);
});

test("returns null when no agent has a qualifying score", async () => {
  const pool = fakePool([[], [], []]);
  assert.equal(await queryTopScorerForWeek(pool, "inbound", params), null);
});

test("does not double-bind callType when a direction filter is active", async () => {
  const pool = fakePool([[{ agentName: "Amit", avgScore: 0.91, callCount: 4 }]]);
  const result = await queryTopScorerForWeek(pool, "outbound", {
    ...params,
    callType: "Outbound",
  });
  assert.equal(result.agentName, "Amit");
  assert.equal(result.avgScore, 91);
});

test("never casts AIScoring without TRY_CAST", async () => {
  const pool = fakePool([[], [], []]);
  await queryTopScorerForWeek(pool, "outbound", params);
  const joined = pool.queries.join("\n");
  assert.ok(!/[^_]CAST\(APR\.AIScoring/.test(joined), "AIScoring must use TRY_CAST");
  assert.match(joined, /TRY_CAST\(APR\.AIScoring/);
});
