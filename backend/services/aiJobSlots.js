/**
 * Sprint 9 — enforce license maxConcurrentJobs before AI dispatch.
 */
const sql = require("../sqlClient");
const { connectToDatabase } = require("../dbConnection");
const { effectiveMaxConcurrentJobs } = require("./aiEntitlement");
const { isActiveProcessingStatus } = require("./reportHelpers");

async function countActiveAiJobs(pool) {
  const result = await pool.request().query(`
    SELECT AU.ProcessStatus, APR.Status AS AIStatus
    FROM dbo.AudioUploads AU
    LEFT JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
    WHERE AU.UploadDate > DATEADD(DAY, -2, GETDATE())
  `);
  let n = 0;
  for (const row of result.recordset) {
    if (isActiveProcessingStatus(row.ProcessStatus, row.AIStatus)) n += 1;
  }
  return n;
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string, active?: number, max?: number }>}
 */
async function tryAcquireAiSlot() {
  const max = effectiveMaxConcurrentJobs();
  if (!max) return { ok: true, max: 0 };

  const pool = await connectToDatabase();
  const active = await countActiveAiJobs(pool);
  if (active >= max) {
    return {
      ok: false,
      reason: `AI concurrency limit reached (${active}/${max} jobs).`,
      active,
      max,
    };
  }
  return { ok: true, active, max };
}

module.exports = { tryAcquireAiSlot, countActiveAiJobs };
