/**
 * Unit tests for Users.LoginAlias migration.
 * Run: node --test test/dbMigrate.loginAlias.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ensureUsersLoginAliasColumn } = require("../services/dbMigrate");

function createMockPool(initial = {}) {
  const state = {
    tables: initial.tables || ["Users"],
    columns: initial.columns || { Users: [] },
    indexes: initial.indexes || [],
    queries: [],
  };

  const pool = {
    request() {
      const req = {
        input(name, value) {
          req._inputs = req._inputs || {};
          req._inputs[name] = value;
          return req;
        },
        async query(sql) {
          const q = String(sql).replace(/\s+/g, " ").trim();
          state.queries.push(q);

          if (q.includes("FROM INFORMATION_SCHEMA.COLUMNS")) {
            const table = req._inputs?.table;
            const column = req._inputs?.column;
            const cols = state.columns[table] || [];
            return { recordset: [{ cnt: cols.includes(column) ? 1 : 0 }] };
          }
          if (q.includes("FROM sys.tables")) {
            const table = req._inputs?.table;
            return { recordset: [{ cnt: state.tables.includes(table) ? 1 : 0 }] };
          }
          if (q.includes("FROM sys.indexes")) {
            const indexName = req._inputs?.indexName;
            return { recordset: [{ cnt: state.indexes.includes(indexName) ? 1 : 0 }] };
          }
          if (q.includes("ALTER TABLE dbo.Users ADD LoginAlias")) {
            state.columns.Users = [...(state.columns.Users || []), "LoginAlias"];
          }
          if (q.includes("CREATE UNIQUE NONCLUSTERED INDEX UQ_Users_LoginAlias")) {
            state.indexes.push("UQ_Users_LoginAlias");
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  };

  return { pool, state };
}

describe("ensureUsersLoginAliasColumn", () => {
  it("adds LoginAlias column and index when missing", async () => {
    const { pool, state } = createMockPool();
    await ensureUsersLoginAliasColumn(pool);
    assert.ok(state.columns.Users.includes("LoginAlias"));
    assert.ok(state.indexes.includes("UQ_Users_LoginAlias"));
    assert.ok(state.queries.some((q) => q.includes("ALTER TABLE dbo.Users ADD LoginAlias")));
  });

  it("skips ALTER when LoginAlias already exists", async () => {
    const { pool, state } = createMockPool({
      columns: { Users: ["LoginAlias"] },
      indexes: ["UQ_Users_LoginAlias"],
    });
    await ensureUsersLoginAliasColumn(pool);
    assert.equal(state.queries.some((q) => q.includes("ALTER TABLE")), false);
  });
});
