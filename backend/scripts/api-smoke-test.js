#!/usr/bin/env node
/**
 * API smoke test — exercises critical backend endpoints against a running server.
 *
 * Usage:
 *   BASE_URL=http://localhost:5000 \
 *   SMOKE_USER_ID=superadmin SMOKE_PASSWORD='...' \
 *   SMOKE_QUESTION='Favorite color' SMOKE_ANSWER='Blue' \
 *   node scripts/api-smoke-test.js
 *
 * Optional: SMOKE_TOKEN=... (skip login)
 */
require("dotenv").config();
const axios = require("axios");

const BASE_URL = (process.env.BASE_URL || process.env.SMOKE_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const TOKEN = process.env.SMOKE_TOKEN || "";
const LOGIN_ID = process.env.SMOKE_USER_ID || "superadmin";
const PASSWORD = process.env.SMOKE_PASSWORD || "";
const QUESTION = process.env.SMOKE_QUESTION || "Favorite color";
const ANSWER = process.env.SMOKE_ANSWER || "Blue";

let passed = 0;
let failed = 0;
let token = TOKEN;
const testUserSuffix = `smoke_${Date.now()}`;

function client() {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return axios.create({ baseURL: BASE_URL, headers, validateStatus: () => true, timeout: 30000 });
}

function record(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  OK   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

async function runStep(name, fn) {
  try {
    const ok = await fn();
    record(name, ok !== false, typeof ok === "string" ? ok : "");
    return ok !== false;
  } catch (err) {
    record(name, false, err.message);
    return false;
  }
}

async function login() {
  if (token) return true;
  if (!PASSWORD) {
    console.error("Set SMOKE_TOKEN or SMOKE_PASSWORD to authenticate.");
    return false;
  }
  const res = await client().post("/api/login-security", {
    userId: LOGIN_ID,
    password: PASSWORD,
    questionType: QUESTION,
    questionAnswer: ANSWER,
  });
  if (!res.data?.success || !res.data?.token) {
    record("login", false, res.data?.message || `HTTP ${res.status}`);
    return false;
  }
  token = res.data.token;
  record("login", true, LOGIN_ID);
  return true;
}

async function main() {
  console.log(`\nAPI smoke test → ${BASE_URL}\n`);

  const healthOk = await runStep("GET /api/system-monitor/health", async () => {
    const res = await client().get("/api/system-monitor/health");
    return res.status === 200 && res.data?.status === "healthy";
  });

  if (!healthOk) {
    console.error("\nBackend not reachable. Start sp_backend or set BASE_URL.");
    process.exit(1);
  }

  const authed = await login();
  if (!authed) process.exit(1);

  const api = client();

  await runStep("POST /api/verify-session", async () => {
    const res = await api.post("/api/verify-session", { userId: LOGIN_ID });
    return res.status === 200 && res.data?.success;
  });

  await runStep("GET /api/users/list", async () => {
    const res = await api.get("/api/users/list");
    return res.status === 200 && res.data?.success && Array.isArray(res.data.users);
  });

  await runStep("GET /api/users/search", async () => {
    const res = await api.get("/api/users/search", { params: { q: "super" } });
    return res.status === 200 && res.data?.success;
  });

  const createBody = {
    userId: testUserSuffix,
    username: testUserSuffix,
    password: "SmokeTest1!",
    email: `${testUserSuffix}@example.test`,
    userType: "Auditor",
    SecurityQuestionType: "Favorite color",
    SecurityQuestionAnswer: "Blue",
    createdBy: LOGIN_ID,
  };

  await runStep("POST /api/user (create)", async () => {
    const res = await api.post("/api/user", createBody);
    if (res.status === 201 && res.data?.success) return true;
    return `HTTP ${res.status}: ${res.data?.message || "unknown"}`;
  });

  await runStep("GET /api/user/:username", async () => {
    const res = await api.get(`/api/user/${encodeURIComponent(testUserSuffix)}`);
    return res.status === 200 && res.data?.success;
  });

  await runStep("PUT /api/user/:username/email", async () => {
    const res = await api.put(`/api/user/${encodeURIComponent(testUserSuffix)}/email`, {
      email: `updated_${testUserSuffix}@example.test`,
    });
    return res.status === 200 && res.data?.success;
  });

  await runStep("GET /api/agents", async () => {
    const res = await api.get("/api/agents");
    return res.status === 200;
  });

  await runStep("GET /api/locations", async () => {
    const res = await api.get("/api/locations");
    return res.status === 200 && res.data?.success;
  });

  await runStep("GET /api/admin/settings", async () => {
    const res = await api.get("/api/admin/settings");
    return res.status === 200 && res.data?.success;
  });

  await runStep("GET /api/license-status", async () => {
    const res = await api.get("/api/license-status");
    return res.status === 200;
  });

  await runStep("GET /api/reports/realtime-metrics", async () => {
    const res = await api.get("/api/reports/realtime-metrics");
    return res.status === 200;
  });

  await runStep("DELETE /api/user/:username (cleanup)", async () => {
    const res = await api.delete(`/api/user/${encodeURIComponent(testUserSuffix)}`);
    return (res.status === 200 || res.status === 204) && res.data?.success !== false;
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
