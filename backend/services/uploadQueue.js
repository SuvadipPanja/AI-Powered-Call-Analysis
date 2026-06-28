/**
 * Bull queue: upload → AI orchestrator (Sprint 3.3).
 * Falls back to inline processing when REDIS_URL is unset.
 */
const { executePythonScript } = require("../pythonScriptHandler");

let Queue = null;
let queue = null;

function queueEnabled() {
  return String(process.env.UPLOAD_QUEUE_ENABLED || "true").toLowerCase() !== "false"
    && Boolean(process.env.REDIS_URL);
}

function getQueue() {
  if (queue) return queue;
  if (!queueEnabled()) return null;
  try {
    Queue = Queue || require("bull");
    queue = new Queue("audio-upload", process.env.REDIS_URL, {
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 100,
        attempts: parseInt(process.env.UPLOAD_QUEUE_ATTEMPTS || "3", 10),
        backoff: {
          type: "exponential",
          delay: parseInt(process.env.UPLOAD_QUEUE_BACKOFF_MS || "5000", 10),
        },
      },
    });
    return queue;
  } catch (err) {
    console.warn("[WARN] Bull queue unavailable:", err.message);
    return null;
  }
}

async function updateUploadStatus(pool, sql, fileName, processStatus) {
  await pool.request()
    .input("status", sql.NVarChar, processStatus)
    .input("fileName", sql.NVarChar, fileName)
    .query(`
      UPDATE AudioUploads
      SET ProcessStatus = @status
      WHERE AudioFileName = @fileName
    `);
}

function runAiJob(audioFileName, { sql, config, writeLog }) {
  return new Promise((resolve, reject) => {
    executePythonScript("", [audioFileName], async (code) => {
      try {
        const pool = await sql.connect(config);
        const processStatus =
          code === 0
            ? "In Progress"
            : "Error: request to AI‑Main failed";
        await updateUploadStatus(pool, sql, audioFileName, processStatus);
        writeLog(`[Upload Queue] ProcessStatus → '${processStatus}' for ${audioFileName}`);
        resolve({ code, processStatus });
      } catch (err) {
        writeLog(`[Upload Queue] DB update failed for ${audioFileName}: ${err.message}`);
        reject(err);
      }
    });
  });
}

async function enqueueAudioProcessing(audioFileName, deps) {
  // Sprint 9 — defense in depth: never run the AI pipeline without a license
  // that permits it, even if a caller bypassed the upload handler.
  try {
    const { checkAiEntitlement } = require("./aiEntitlement");
    const entitlement = checkAiEntitlement();
    if (!entitlement.ok) {
      deps.writeLog(`[Upload Queue] AI dispatch skipped (${audioFileName}): ${entitlement.reason}`);
      try {
        const pool = await deps.sql.connect(deps.config);
        await updateUploadStatus(pool, deps.sql, audioFileName, "Error: AI not licensed");
      } catch { /* best-effort status update */ }
      return { queued: false, mode: "blocked", reason: entitlement.reason };
    }
  } catch (err) {
    deps.writeLog(`[Upload Queue] Entitlement check error for ${audioFileName}: ${err.message}`);
  }

  const q = getQueue();
  if (!q) {
    runAiJob(audioFileName, deps).catch((err) => {
      deps.writeLog(`[Upload Queue] Inline job failed for ${audioFileName}: ${err.message}`);
    });
    return { queued: false, mode: "inline" };
  }

  const job = await q.add(
    { audioFileName },
    { jobId: `upload-${audioFileName}`, timeout: 120_000 }
  );
  return { queued: true, mode: "bull", jobId: job.id };
}

function startUploadWorker(deps) {
  const q = getQueue();
  if (!q) {
    console.log("[INFO] Upload queue worker skipped (REDIS_URL unset or queue disabled).");
    return null;
  }

  const concurrency = parseInt(process.env.UPLOAD_QUEUE_CONCURRENCY || "2", 10);

  q.process(concurrency, async (job) => {
    const { audioFileName } = job.data;
    deps.writeLog(`[Upload Queue] Processing job ${job.id} for ${audioFileName}`);
    return runAiJob(audioFileName, deps);
  });

  q.on("failed", (job, err) => {
    deps.writeLog(`[Upload Queue] Job ${job?.id} failed: ${err.message}`);
  });

  q.on("completed", (job) => {
    deps.writeLog(`[Upload Queue] Job ${job.id} completed`);
  });

  console.log(`[INFO] Upload queue worker started (concurrency=${concurrency}).`);
  return q;
}

async function closeUploadQueue() {
  if (queue) {
    await queue.close().catch(() => {});
    queue = null;
  }
}

module.exports = {
  enqueueAudioProcessing,
  startUploadWorker,
  closeUploadQueue,
  queueEnabled,
};
