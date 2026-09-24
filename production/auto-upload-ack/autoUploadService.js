/**
 * AutoUploadService — integrated auto-upload for AI-powered call analysis.
 * Ported from standalone AutoUpload/autoAudioUploader.js into the main backend.
 *
 * Reads metadata CSVs from date-based sub-folders (DD_MM_YYYY), matches them
 * to audio files, copies into the upload directory, and triggers the same AI
 * processing pipeline used by manual /upload-audio.
 */

const fs     = require('fs');
const path   = require('path');
const { parse }    = require('csv-parse');
const { stringify } = require('csv-stringify/sync');
const moment = require('moment-timezone');
const cron   = require('node-cron');
const sql    = require('../sqlClient');
const dbPools = require('./dbPools');

const { executePythonScript, getAiJobStatus } = require('../pythonScriptHandler');
const { openAdmissionJournal, admitOwnedRun, recoverPreparedRun } = require('./autoUploadAdmission');
const { overlapEnabled } = require('./aiDispatchProtocol');
const { runStageFeeder, duplicateCsvIndices } = require('./autoUploadStageFeeder');
const { resolveProjectPath } = require('../projectPaths');
const { resolveBatchPath, normalizeSlashes } = require('./batchPathResolve');
const { normalizeHistoryErrors } = require('./autoUploadHistory');

const IST = 'Asia/Kolkata';

const SETTING_KEY = 'auto_upload_config';

let _running        = false;
/** @type {null|'pause'|'abort'} Cooperative pause finishes the current call first. */
let _haltMode       = null;
let _cronJob        = null;
let _historyTableOk = false;

const STATE_FILENAME = '.auto-upload-state.json';

/** In-memory live run state for admin polling (GET /status). */
let _runState = createIdleRunState();

function createIdleRunState() {
  return {
    status: 'idle',
    targetFolder: '',
    targetDate: '',
    metadataFile: '',
    startedAt: null,
    completedAt: null,
    stoppedAt: null,
    pausedAt: null,
    currentIndex: 0,
    total: 0,
    resumeFromIndex: null,
    canResume: false,
    haltMode: null,
    haltRequested: false,
    currentFile: null,
    counts: { total: 0, pending: 0, succeeded: 0, skipped: 0, failed: 0, paused: 0 },
    items: [],
    triggeredBy: '',
    durationSeconds: 0,
    elapsedSeconds: 0,
    avgSuccessSeconds: null,
    estimateCallSeconds: null,
    avgSource: null,
    etaSeconds: null,
    errors: [],
  };
}

function isAbortRequested() {
  return _haltMode === 'abort';
}

function isPauseRequested() {
  return _haltMode === 'pause';
}

/** True when any halt was requested (pause or abort). */
function isStopRequested() {
  return _haltMode === 'pause' || _haltMode === 'abort';
}

function isRunActive() {
  return _running || _runState.status === 'running';
}

/**
 * Pause: finish the current call (including AI wait), then do not start the next.
 * Resume continues from the next pending index.
 */
function requestPause() {
  if (!isRunActive()) return false;
  if (_haltMode === 'abort') return true; // abort already supersedes
  _haltMode = 'pause';
  _runState.haltMode = 'pause';
  _runState.haltRequested = true;
  log('[AutoUpload] Pause requested — will finish current call, then hold');
  return true;
}

/**
 * Abort: stop admission immediately; accepted AI calls retain ownership and drain.
 */
function requestAbort() {
  if (!isRunActive()) return false;
  _haltMode = 'abort';
  _runState.haltMode = 'abort';
  _runState.haltRequested = true;
  log('[AutoUpload] Abort requested — stopping admission; accepted calls will finish safely');
  return true;
}

/** @deprecated Prefer requestPause(); kept so older clients keep working. */
function requestStop() {
  return requestPause();
}

function getStateFilePath(csvPath) {
  return path.join(path.dirname(csvPath), STATE_FILENAME);
}

function readPersistedState(statePath) {
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function writePersistedState(statePath, data) {
  fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf8');
}

function clearPersistedState(statePath) {
  try {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  } catch { /* ignore */ }
}

function listStoppedRuns(metadataParentPath) {
  if (!metadataParentPath || !fs.existsSync(metadataParentPath)) return [];

  const runs = [];
  const seen = new Set();

  function tryAddStateFile(statePath) {
    if (seen.has(statePath)) return;
    seen.add(statePath);
    const data = readPersistedState(statePath);
    if (data && (data.status === 'stopped' || data.status === 'paused')) {
      runs.push({
        targetFolder: data.targetFolder || '',
        metadataFile: data.metadataFile || '',
        resumeFromIndex: data.resumeFromIndex ?? 0,
        lastCompletedIndex: data.lastCompletedIndex ?? 0,
        stoppedAt: data.stoppedAt || data.pausedAt || null,
        status: data.status,
        haltMode: data.haltMode || (data.status === 'paused' ? 'pause' : 'abort'),
        total: data.total ?? 0,
        counts: data.counts || null,
        triggeredBy: data.triggeredBy || '',
      });
    }
  }

  tryAddStateFile(path.join(metadataParentPath, STATE_FILENAME));

  let entries = [];
  try {
    entries = fs.readdirSync(metadataParentPath, { withFileTypes: true });
  } catch {
    return runs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    tryAddStateFile(path.join(metadataParentPath, entry.name, STATE_FILENAME));
  }

  runs.sort((a, b) => (b.stoppedAt || '').localeCompare(a.stoppedAt || ''));
  return runs;
}

function recoverStalePersistedRuns(metadataParentPath) {
  if (!metadataParentPath || !fs.existsSync(metadataParentPath)) return;

  const statePaths = [path.join(metadataParentPath, STATE_FILENAME)];

  try {
    for (const entry of fs.readdirSync(metadataParentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        statePaths.push(path.join(metadataParentPath, entry.name, STATE_FILENAME));
      }
    }
  } catch { /* ignore */ }

  for (const statePath of statePaths) {
    const data = readPersistedState(statePath);
    if (!data || data.status !== 'running') continue;
    log(`[AutoUpload] Recovering stale run state: ${statePath}`);
    writePersistedState(statePath, {
      ...data,
      status: 'stopped',
      stoppedAt: new Date().toISOString(),
      resumeFromIndex: data.resumeFromIndex ?? data.currentIndex ?? 0,
    });
  }
}

async function cleanupPartialUpload(pool, destFileName, destPath) {
  try {
    if (destPath && fs.existsSync(destPath)) fs.unlinkSync(destPath);
  } catch { /* ignore */ }
  if (!destFileName) return;
  try {
    await pool.request()
      .input('fn', sql.NVarChar, destFileName)
      .query('DELETE FROM dbo.AI_Processing_Result WHERE AudioFileName = @fn');
    await pool.request()
      .input('fn', sql.NVarChar, destFileName)
      .query('DELETE FROM dbo.AudioUploads WHERE AudioFileName = @fn');
  } catch { /* ignore */ }
}

function cloneRunState() {
  return JSON.parse(JSON.stringify(_runState));
}

/** Fallback AI duration when no successful call has finished yet (seconds). */
const DEFAULT_CALL_ESTIMATE_SEC = 90;

function recalcRunCounts() {
  const c = {
    total: _runState.items.length,
    pending: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    paused: 0,
  };
  let successDurSum = 0;
  let successDurN = 0;
  for (const item of _runState.items) {
    if (item.status === 'pending' || item.status === 'processing') c.pending++;
    else if (item.status === 'succeeded') {
      c.succeeded++;
      // Skips are 0s — only real AI completions feed the average.
      if (typeof item.durationSec === 'number' && item.durationSec > 0) {
        successDurSum += item.durationSec;
        successDurN++;
      }
    } else if (item.status === 'skipped') c.skipped++;
    else if (item.status === 'failed') c.failed++;
    else if (item.status === 'paused') c.paused++;
  }
  _runState.counts = c;
  _runState.total = c.total;
  _runState.avgSuccessSeconds = successDurN ? Math.round(successDurSum / successDurN) : null;

  if (_runState.startedAt && (_runState.status === 'running' || _running)) {
    _runState.elapsedSeconds = Math.round(
      (Date.now() - new Date(_runState.startedAt).getTime()) / 1000,
    );
  }

  // Provisional estimate while the first real call is still in AI: use its
  // elapsed so far (floored) or a default, so ETA is not blank for 2–3 minutes.
  let provisionalSec = null;
  const currentName = _runState.currentFile?.audio_name;
  if (currentName) {
    const cur = findRunItem(currentName);
    if (cur?.startedAt && (cur.status === 'processing' || _runState.status === 'running')) {
      provisionalSec = Math.max(
        30,
        Math.round((Date.now() - Date.parse(cur.startedAt)) / 1000),
      );
    }
  }
  const estimateSec = _runState.avgSuccessSeconds
    ?? provisionalSec
    ?? (_runState.status === 'running' && c.pending > 0 ? DEFAULT_CALL_ESTIMATE_SEC : null);

  _runState.estimateCallSeconds = estimateSec;
  _runState.avgSource = _runState.avgSuccessSeconds != null
    ? 'measured'
    : (provisionalSec != null ? 'in_progress' : (estimateSec != null ? 'default' : null));

  if (estimateSec != null && c.pending > 0 && (_runState.status === 'running' || _running)) {
    _runState.etaSeconds = estimateSec * c.pending;
  } else {
    _runState.etaSeconds = null;
  }
}

function findRunItem(file) {
  return _runState.items.find((i) => i.file === file);
}

function updateRunItem(file, patch) {
  const item = findRunItem(file);
  if (item) Object.assign(item, patch);
  recalcRunCounts();
}

function pushStage(file, stage, message = '') {
  const item = findRunItem(file);
  if (!item) return;
  if (!Array.isArray(item.stages)) item.stages = [];
  const now = new Date().toISOString();
  const last = item.stages[item.stages.length - 1];
  if (last && !last.endedAt) {
    last.endedAt = now;
    last.durationSec = Math.max(
      0,
      Math.round((Date.parse(now) - Date.parse(last.startedAt)) / 1000),
    );
  }
  item.stages.push({ stage, message, startedAt: now, endedAt: null, durationSec: null });
}

function setCurrentFile(record, stage, message = '') {
  _runState.currentFile = {
    audio_name: record.audio_name,
    employee_name: record.employee_name,
    stage,
    message,
    startedAt: findRunItem(record.audio_name)?.startedAt || new Date().toISOString(),
  };
  const item = findRunItem(record.audio_name);
  if (item && !item.startedAt) item.startedAt = new Date().toISOString();
  pushStage(record.audio_name, stage, message);
  updateRunItem(record.audio_name, { stage, message, status: 'processing' });
}

const uploadDirectory = resolveProjectPath(process.env.AUDIO_UPLOAD_DIR || '');

/* ===================================================================
   Default settings
   =================================================================== */

function defaultSettings() {
  return {
    audioParentPath:    '',
    metadataParentPath: '',
    dateMode:           'relative',
    offsetDays:         1,
    specificDate:       '',
    enabled:            false,
    cronSchedule:       '0 1 * * *',
  };
}

/* ===================================================================
   Settings CRUD (stored as JSON in dbo.AppSettings)
   =================================================================== */

async function getSettings(pool) {
  const r = await pool.request()
    .input('key', sql.NVarChar, SETTING_KEY)
    .query('SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = @key');
  if (!r.recordset.length) return defaultSettings();
  try {
    const loaded = { ...defaultSettings(), ...JSON.parse(r.recordset[0].SettingValue) };
    // Rewrite host paths that were saved before path mapping existed.
    loaded.audioParentPath = resolveBatchPath(loaded.audioParentPath, 'audio').path;
    loaded.metadataParentPath = resolveBatchPath(loaded.metadataParentPath, 'metadata').path;
    return loaded;
  } catch {
    return defaultSettings();
  }
}

async function saveSettings(pool, body, username) {
  const current = await getSettings(pool);
  const audioResolved = resolveBatchPath(
    body.audioParentPath ?? current.audioParentPath,
    'audio',
  );
  const metaResolved = resolveBatchPath(
    body.metadataParentPath ?? current.metadataParentPath,
    'metadata',
  );
  const merged  = {
    // Persist the container-visible path so cron/resume keep working after save
    // even when the admin pasted a host WinSCP path.
    audioParentPath:    audioResolved.path,
    metadataParentPath: metaResolved.path,
    dateMode:           body.dateMode           ?? current.dateMode,
    offsetDays:         parseInt(body.offsetDays ?? current.offsetDays, 10) || 1,
    specificDate:       body.specificDate        ?? current.specificDate,
    enabled:            typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    cronSchedule:       body.cronSchedule       ?? current.cronSchedule,
  };
  if (merged.enabled && merged.cronSchedule && !cron.validate(merged.cronSchedule)) {
    throw new Error(`Invalid cron expression: ${merged.cronSchedule}`);
  }
  await pool.request()
    .input('key',       sql.NVarChar, SETTING_KEY)
    .input('value',     sql.NVarChar, JSON.stringify(merged))
    .input('updatedBy', sql.NVarChar, username)
    .query(`
      MERGE dbo.AppSettings AS target
      USING (SELECT @key AS SettingKey) AS source
      ON target.SettingKey = source.SettingKey
      WHEN MATCHED THEN
        UPDATE SET SettingValue = @value, UpdatedAt = GETDATE(), UpdatedBy = @updatedBy
      WHEN NOT MATCHED THEN
        INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@key, @value, @updatedBy);
    `);
  return merged;
}

/* ===================================================================
   Date helpers
   =================================================================== */

function getTargetDateStr(settings) {
  if (settings.dateMode === 'specific' && settings.specificDate) {
    return moment(settings.specificDate).format('DD_MM_YYYY');
  }
  const offset = Math.max(1, parseInt(settings.offsetDays, 10) || 1);
  return moment().tz(IST).subtract(offset, 'days').format('DD_MM_YYYY');
}

function reformatDateForSql(dateStr) {
  const parts = dateStr.split(/[-_]/);
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return dateStr;
}

/* ===================================================================
   CSV helpers
   =================================================================== */

function readMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true }))
      .on('data', (r) => {
        rows.push({
          audio_name:      r.audio_name      || '',
          call_date:       r.call_date       || '',
          employee_name:   r.employee_name   || '',
          audio_type:      r.audio_type      || '',
          status:          r.status           || '',
          processing_time: r.processing_time  || '',
          failure_reason:  r.failure_reason   || '',
        });
      })
      .on('end',   () => resolve(rows))
      .on('error', reject);
  });
}

function writeMetadata(filePath, records) {
  fs.writeFileSync(filePath, stringify(records, { header: true }));
}

/* ===================================================================
   Agent validation (direct DB)
   =================================================================== */

async function validateAgent(pool, name) {
  try {
    const centerScope = require("./centerScope");
    const { agentInActiveCenterSql } = require("./agentListQuery");
    const centerKey = await centerScope.getActiveCenterKey(pool);
    const r = await pool.request()
      .input("agent", sql.NVarChar, name)
      .input("centerKey", sql.NVarChar, centerKey)
      .query(agentInActiveCenterSql());
    return r.recordset.length > 0;
  } catch {
    return false;
  }
}

/* ===================================================================
   Dedup check
   =================================================================== */

async function isAlreadyUploaded(pool, originalFileName) {
  try {
    const r = await pool.request()
      .input('pat', sql.NVarChar, `%-${originalFileName}`)
      .query('SELECT TOP 1 AudioFileName, ProcessStatus FROM dbo.AudioUploads WHERE AudioFileName LIKE @pat ORDER BY UploadDate DESC');
    return r.recordset[0] || null;
  } catch (error) {
    throw new Error(`Duplicate ownership check unavailable: ${error.message}`);
  }
}

/* ===================================================================
   Poll processing status
   =================================================================== */

async function pollStatus(pool, audioFileName, maxMs = 600000, interval = 5000, shouldStop = () => false, onPoll = async () => {}, runId = '') {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (shouldStop()) return { status: 'Stopped', error: null, stopped: true };
    await onPoll();
    if (runId) {
      try {
        const terminal = await readTerminalStatus(pool, audioFileName, runId);
        if (terminal) return terminal;
      } catch { /* retry without guessing completion */ }
      await sleep(interval);
      continue;
    }
    try {
      const r = await pool.request()
        .input('fn', sql.NVarChar, audioFileName)
        .query(`
          SELECT AU.ProcessStatus, APR.Status AS AIStatus
          FROM   dbo.AudioUploads AU
          LEFT JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
          WHERE  AU.AudioFileName = @fn
        `);
      if (r.recordset.length) {
        const ps = (r.recordset[0].ProcessStatus || '').toLowerCase();
        const ai = (r.recordset[0].AIStatus || '').toLowerCase();
        if (ai === 'success' || ps.includes('success')) return { status: 'Success', error: null };
        if (ai === 'fail' || ai === 'failed' || ps.includes('error') || ps.includes('failed'))
          return { status: 'Fail', error: r.recordset[0].ProcessStatus };
      }
    } catch { /* retry */ }
    if (shouldStop()) return { status: 'Stopped', error: null, stopped: true };
    await sleep(interval);
  }
  return { status: 'Unknown', error: `Completion not confirmed after ${maxMs / 1000}s`, stopped: true };
}

/* ===================================================================
   Resolve file paths
   =================================================================== */

function dateFolderVariants(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!raw) return [];
  const underscored = raw.replace(/-/g, '_');
  const dashed = raw.replace(/_/g, '-');
  return [...new Set([raw, underscored, dashed])];
}

function resolveAudioPath(record, settings) {
  const parent = resolveBatchPath(settings.audioParentPath, 'audio').path;
  const name = record.audio_name;
  const candidates = [];
  for (const d of dateFolderVariants(record.call_date)) {
    candidates.push(path.join(parent, d, name));
  }
  candidates.push(path.join(parent, name));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveMetadataCsv(settings, dateStr) {
  const parent = resolveBatchPath(settings.metadataParentPath, 'metadata').path;
  const candidates = [];
  for (const d of dateFolderVariants(dateStr)) {
    candidates.push(path.join(parent, d, `metadata_${d}.csv`));
    candidates.push(path.join(parent, d, `metadata_${dateStr}.csv`));
    candidates.push(path.join(parent, `metadata_${d}.csv`));
  }
  candidates.push(path.join(parent, `metadata_${dateStr}.csv`));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* ===================================================================
   Process one audio record
   =================================================================== */

async function processRecord(pool, record, csvPath, allRecords, settings, onProgress, context = {}) {
  const tag = `[AutoUpload] ${record.audio_name}`;
  const progress = (stage, message = '') => onProgress?.({ stage, message });
  const journal = context.journal || openAdmissionJournal(csvPath);
  let job = journal.get(record.audio_name);
  const t0 = job?.startedAt || Date.now();
  const finishFailure = (reason) => {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    Object.assign(record, { status: 'Fail', failure_reason: reason, processing_time: String(elapsed) });
    writeMetadata(csvPath, allRecords);
    return { success: false, reason, durationSec: elapsed };
  };
  const hold = (reason) => {
    progress('Awaiting reconciliation', reason);
    return { stopped: true, reason, retained: Boolean(job) };
  };
  try {
    const csvStatus = String(record.status || '').trim().toLowerCase();
    if (record.status && csvStatus !== 'fail' && csvStatus !== 'failed') {
      if (!(await reconcileCompletedCsv(pool, record, journal))) return hold('CSV completion and retained AI ownership need reconciliation.');
      return { skipped: true, reason: 'already_processed', durationSec: 0 };
    }
    if (!job) {
      if (isStopRequested()) return hold('Admission stopped before preparing this call.');
      record.status = '';
      record.failure_reason = '';
      progress('Checking agent');
      if (!(await validateAgent(pool, record.employee_name))) return finishFailure('Agent not in active list');
      const audioPath = resolveAudioPath(record, settings);
      if (!audioPath) return finishFailure('Audio file not found on disk');
      progress('Checking duplicate');
      const duplicate = await isAlreadyUploaded(pool, record.audio_name);
      if (duplicate) {
        if (!/success|fail|error/i.test(String(duplicate.ProcessStatus || ''))) {
          return hold('An existing nonterminal upload has no matching admission journal; reconcile it before resuming.');
        }
        Object.assign(record, { status: 'Skipped', failure_reason: 'Already uploaded', processing_time: '0' });
        writeMetadata(csvPath, allRecords);
        return { skipped: true, reason: 'Already uploaded in system', durationSec: 0 };
      }
      if (isStopRequested()) return hold('Admission stopped before copying this call.');
      const { createQueueRunId, markQueuedRun } = require('./uploadQueue');
      const runId = createQueueRunId();
      const audioFile = `${Date.now()}-${runId.slice(0, 8)}-${record.audio_name}`;
      const destPath = path.join(uploadDirectory, audioFile);
      progress('Copying audio');
      fs.copyFileSync(audioPath, destPath);
      progress('Uploading');
      job = { audioFile, runId, phase: 'prepared', startedAt: t0 };
      // Save identity before any DB insertion, queue transition or HTTP submission.
      journal.set(record.audio_name, job);
      if (!(await insertPendingUpload(pool, record, audioFile))) return hold('Prepared upload already exists; reconcile ownership before dispatch.');
      await markQueuedRun(pool, audioFile, Date.now(), runId, { sql, source: 'auto_upload' });
      job.phase = 'queued';
      journal.set(record.audio_name, job);
    }
    const { reserveAiDispatchSlot } = require('./aiJobSlots');
    const { assertAiEnqueueAllowed } = require('./aiWorkToken');
    const { updateUploadStatusForRun, isDispatchPaused, markQueuedRun } = require('./uploadQueue');
    const save = (current) => journal.set(record.audio_name, current);
    if (job.phase === 'prepared') {
      const recovered = await recoverPreparedRun({ job, save,
        load: () => readOwnedUpload(pool, job.audioFile),
        createPending: async () => {
          if (!fs.existsSync(path.join(uploadDirectory, job.audioFile))) return false;
          return insertPendingUpload(pool, record, job.audioFile);
        },
        markQueued: () => markQueuedRun(pool, job.audioFile, Date.now(), job.runId, { sql, source: 'auto_upload' }),
      });
      if (!recovered) return hold('Prepared upload ownership changed; reconciliation required.');
    }
    if (job.phase === 'rejected') {
      if (!(await persistUnsubmittedRejection(pool, job))) return hold('Rejected run ownership changed; reconciliation required.');
      if (!context.retryFailed) return finishFailure(job.reason || 'AI admission rejected; use Retry-failed after correction.');
      const changed = await requeueUnsubmittedRun(pool, job.audioFile, job.runId);
      if (!changed) return hold('Rejected run ownership changed; reconciliation required.');
      job.phase = 'queued';
      save(job);
    }
    // A resumed accepted run may already have completed before the backend restarted.
    if (job.phase !== 'queued' && job.phase !== 'prepared') {
      const terminal = await readTerminalStatus(pool, job.audioFile, job.runId);
      if (terminal) return complete(terminal);
      // Live controller has no /job-status. A submitting or accepted call was
      // already sent and keeps processing; follow the database instead of pausing.
      if (job.phase === 'submitting' || job.phase === 'accepted') {
        const live = await getAiJobStatus(job.audioFile, job.runId);
        if (live.kind !== 'known') {
          progress('Waiting for AI', 'This call was already sent and is still processing.');
          context.accepted = true;
          const followed = await pollStatus(pool, job.audioFile, 600000, 5000, () => false, async () => {}, job.runId);
          if (followed.stopped) return hold(followed.error || 'AI completion needs reconciliation.');
          return complete(followed);
        }
      }
    }
    progress('Waiting for capacity');
    const outcome = await admitOwnedRun({
      job, save,
      entitlement: assertAiEnqueueAllowed,
      reserve: () => reserveAiDispatchSlot(job.audioFile, job.runId),
      release: () => updateUploadStatusForRun(pool, sql, job.audioFile, 'Queued', job.runId, { dispatchOnly: true }),
      reconcile: () => getAiJobStatus(job.audioFile, job.runId),
      shouldStop: () => isStopRequested() || isDispatchPaused(),
      onWait: (reason) => progress('Waiting for capacity', reason),
      dispatch: (beforeSubmit) => executePythonScript('', [job.audioFile], undefined,
        { runId: job.runId, reserved: true, beforeSubmit, controllerInstanceId: job.controllerInstanceId }),
    });
    if (outcome.kind === 'waiting' || outcome.kind === 'unknown') return hold(outcome.reason);
    if (outcome.kind === 'rejected') {
      // Persist proof first: a crash during the DB or CSV write remains recoverable.
      job.phase = 'rejected';
      job.reason = outcome.reason;
      save(job);
      if (!(await persistUnsubmittedRejection(pool, job))) return hold('Rejected admission has conflicting database ownership.');
      return finishFailure(outcome.reason);
    }
    context.accepted = true;
    context.asrComplete = outcome.asrComplete === true;
    progress('Waiting for AI');
    // Pause/abort stops new admission. Accepted workers retain their files and drain.
    const result = await pollStatus(pool, job.audioFile, 600000, 5000, () => false, async () => {
      if (!context.overlap || context.asrComplete) return;
      const state = await getAiJobStatus(job.audioFile, job.runId);
      context.asrComplete = state.kind === 'known' && state.asrComplete === true
        && Boolean(job.controllerInstanceId) && state.controllerInstanceId === job.controllerInstanceId;
    }, job.runId);
    if (result.stopped) return hold(result.error || 'AI completion needs reconciliation.');
    return complete(result);
  } catch (error) {
    log(`${tag}: ${error.message}`);
    // Once persisted, ownership is retained through every uncertain failure.
    if (job) return hold(`Retained call needs reconciliation: ${error.message}`);
    if (isStopRequested()) return hold('Stopped before AI submission.');
    return finishFailure(error.message);
  }

  function complete(result) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    Object.assign(record, { status: result.status, processing_time: String(elapsed),
      failure_reason: result.status === 'Fail' ? (result.error || 'Processing failed') : '' });
    writeMetadata(csvPath, allRecords);
    journal.remove(record.audio_name);
    progress('Done', result.status === 'Success' ? 'Success' : record.failure_reason);
    return { success: result.status === 'Success', reason: record.failure_reason || 'Success', durationSec: elapsed };
  }
}

async function readOwnedUpload(pool, audioFileName) {
  const response = await pool.request().input('fn', sql.NVarChar, audioFileName).query(`
    SELECT AU.ProcessStatus, APR.Status AS AIStatus,
      (SELECT TOP (1) JSON_VALUE(CASE WHEN ISJSON(L.Detail) = 1 THEN L.Detail ELSE '{}' END, '$.run_id')
       FROM dbo.CallProcessingLog L WHERE L.AudioFileName = AU.AudioFileName
         AND JSON_VALUE(CASE WHEN ISJSON(L.Detail) = 1 THEN L.Detail ELSE '{}' END, '$.metric') = 'queue_enqueue'
       ORDER BY L.LogID DESC) AS RunId
    FROM dbo.AudioUploads AU
    LEFT JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
    WHERE AU.AudioFileName = @fn`);
  return response.recordset?.[0];
}

async function insertPendingUpload(pool, record, audioFile) {
  const centerScope = require("./centerScope");
  const centerKey = await centerScope.getActiveCenterKey(pool);
  const result = await pool.request()
    .input('fileName', sql.NVarChar, audioFile)
    .input('agent', sql.NVarChar, record.employee_name)
    .input('callDate', sql.Date, reformatDateForSql(record.call_date))
    .input('callType', sql.NVarChar, (record.audio_type || 'inbound').toLowerCase())
    .input('centerKey', sql.NVarChar(64), centerKey)
    .query(`INSERT INTO dbo.AudioUploads
      (AudioFileName, SelectedAgent, SelectedCallDate, CallType, ProcessStatus, UploadDate, CenterKey)
      SELECT @fileName, @agent, @callDate, @callType, 'Pending', GETDATE(), @centerKey
      WHERE NOT EXISTS (SELECT 1 FROM dbo.AudioUploads WITH (UPDLOCK, HOLDLOCK)
        WHERE AudioFileName = @fileName)`);
  return Number(result.rowsAffected?.[0] || 0) === 1;
}

async function readTerminalStatus(pool, audioFileName, runId) {
  const row = await readOwnedUpload(pool, audioFileName);
  if (runId && row?.RunId !== runId) return null;
  const processStatus = String(row?.ProcessStatus || '').toLowerCase();
  const aiStatus = String(row?.AIStatus || '').toLowerCase();
  if (aiStatus === 'success' || processStatus.includes('success')) return { status: 'Success' };
  if (['fail', 'failed'].includes(aiStatus) || /failed|error/.test(processStatus)) {
    return { status: 'Fail', error: row.ProcessStatus };
  }
  return null;
}

async function requeueUnsubmittedRun(pool, audioFileName, runId) {
  const result = await pool.request().input('fn', sql.NVarChar, audioFileName)
    .input('runId', sql.NVarChar, runId).query(`
      UPDATE dbo.AudioUploads SET ProcessStatus = 'Queued'
      WHERE AudioFileName = @fn AND ProcessStatus LIKE 'Failed:%'
        AND @runId = (SELECT TOP (1)
          JSON_VALUE(CASE WHEN ISJSON(L.Detail) = 1 THEN L.Detail ELSE '{}' END, '$.run_id')
          FROM dbo.CallProcessingLog L WHERE L.AudioFileName = @fn
          AND JSON_VALUE(CASE WHEN ISJSON(L.Detail) = 1 THEN L.Detail ELSE '{}' END, '$.metric') = 'queue_enqueue'
          ORDER BY L.LogID DESC)
        AND NOT EXISTS (SELECT 1 FROM dbo.AI_Processing_Result APR WHERE APR.AudioFileName = @fn
          AND LOWER(COALESCE(APR.Status, '')) NOT IN ('', 'queued', 'pending'))
    `);
  return Number(result.rowsAffected?.[0] || 0) === 1;
}

async function persistUnsubmittedRejection(pool, job) {
  const result = await pool.request().input('fn', sql.NVarChar, job.audioFile)
    .input('runId', sql.NVarChar, job.runId)
    .input('status', sql.NVarChar, `Failed: ${job.reason || 'AI admission rejected'}`.slice(0, 50))
    .query(`
      UPDATE dbo.AudioUploads SET ProcessStatus = @status
      WHERE AudioFileName = @fn
        AND (ProcessStatus IN ('Pending', 'Queued', 'Dispatching') OR ProcessStatus LIKE 'Failed:%')
        AND @runId = (SELECT TOP (1)
          JSON_VALUE(CASE WHEN ISJSON(L.Detail) = 1 THEN L.Detail ELSE '{}' END, '$.run_id')
          FROM dbo.CallProcessingLog L WHERE L.AudioFileName = @fn
          AND JSON_VALUE(CASE WHEN ISJSON(L.Detail) = 1 THEN L.Detail ELSE '{}' END, '$.metric') = 'queue_enqueue'
          ORDER BY L.LogID DESC)
        AND NOT EXISTS (SELECT 1 FROM dbo.AI_Processing_Result APR WHERE APR.AudioFileName = @fn
          AND LOWER(COALESCE(APR.Status, '')) NOT IN ('', 'queued', 'pending'))
    `);
  return Number(result.rowsAffected?.[0] || 0) === 1;
}

async function reconcileCompletedCsv(pool, record, journal) {
  const job = journal.get(record.audio_name);
  if (!job || job.phase === 'rejected') return true;
  const status = String(record.status || '').trim().toLowerCase();
  if (!['success', 'fail', 'failed'].includes(status)) return false;
  const terminal = await readTerminalStatus(pool, job.audioFile, job.runId);
  const expected = status === 'success' ? 'Success' : 'Fail';
  if (!terminal || terminal.status !== expected) return false;
  journal.remove(record.audio_name);
  return true;
}

/* ===================================================================
   History table
   =================================================================== */

async function ensureHistoryTable(pool) {
  if (_historyTableOk) return;
  await pool.request().query(`
    IF OBJECT_ID('dbo.AutoUploadHistory', 'U') IS NULL
    CREATE TABLE dbo.AutoUploadHistory (
      RunID           INT IDENTITY(1,1) PRIMARY KEY,
      StartedAt       DATETIME  NOT NULL,
      CompletedAt     DATETIME  NULL,
      Status          NVARCHAR(50)  NOT NULL,
      DateFolder      NVARCHAR(20)  NULL,
      TotalFiles      INT DEFAULT 0,
      Processed       INT DEFAULT 0,
      Succeeded       INT DEFAULT 0,
      Failed          INT DEFAULT 0,
      Skipped         INT DEFAULT 0,
      DurationSeconds INT DEFAULT 0,
      TriggeredBy     NVARCHAR(100) NULL,
      Errors          NVARCHAR(MAX) NULL
    );
  `);
  _historyTableOk = true;
}

async function saveRunHistory(pool, r) {
  try {
    await ensureHistoryTable(pool);
    const errors = normalizeHistoryErrors(r.errors || [], r.items || _runState.items || []);
    await pool.request()
      .input('startedAt',   sql.DateTime,  new Date(r.startedAt))
      .input('completedAt', sql.DateTime,  r.completedAt ? new Date(r.completedAt) : null)
      .input('status',      sql.NVarChar,  r.status)
      .input('dateFolder',  sql.NVarChar,  r.dateFolder  || '')
      .input('totalFiles',  sql.Int,       r.totalFiles  || 0)
      .input('processed',   sql.Int,       r.processed   || 0)
      .input('succeeded',   sql.Int,       r.succeeded   || 0)
      .input('failed',      sql.Int,       r.failed      || 0)
      .input('skipped',     sql.Int,       r.skipped     || 0)
      .input('duration',    sql.Int,       r.durationSeconds || 0)
      .input('triggeredBy', sql.NVarChar,  r.triggeredBy || 'system')
      .input('errors',      sql.NVarChar,  JSON.stringify(errors).slice(0, 100000))
      .query(`
        INSERT INTO dbo.AutoUploadHistory
          (StartedAt, CompletedAt, Status, DateFolder, TotalFiles,
           Processed, Succeeded, Failed, Skipped, DurationSeconds, TriggeredBy, Errors)
        VALUES
          (@startedAt, @completedAt, @status, @dateFolder, @totalFiles,
           @processed, @succeeded, @failed, @skipped, @duration, @triggeredBy, @errors)
      `);
  } catch (err) {
    log(`[AutoUpload] History save failed: ${err.message}`);
  }
}

async function getRunHistory(pool, limit = 20) {
  try {
    await ensureHistoryTable(pool);
    const r = await pool.request()
      .input('n', sql.Int, limit)
      .query('SELECT TOP (@n) * FROM dbo.AutoUploadHistory ORDER BY RunID DESC');
    return r.recordset;
  } catch {
    return [];
  }
}

/* ===================================================================
   Main run
   =================================================================== */

async function runAutoUpload(pool, dbConfig, opts = {}) {
  if (_running) throw new Error('Auto-upload is already running');
  _running = true;
  _haltMode = null;
  const t0 = Date.now();
  const triggeredBy = opts.triggeredBy || 'system';
  const isResume = Boolean(opts.isResume);

  const summary = {
    startedAt: new Date().toISOString(), status: 'running', dateFolder: '',
    totalFiles: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0,
    errors: [], triggeredBy,
  };

  _runState = {
    ...createIdleRunState(),
    status: 'running',
    startedAt: summary.startedAt,
    triggeredBy,
    currentFile: null,
    canResume: false,
    resumeFromIndex: null,
    haltMode: null,
    haltRequested: false,
  };

  let statePath = null;
  let startIndex = typeof opts.resumeFromIndex === 'number' ? opts.resumeFromIndex : 0;
  const onlyAudioNames = Array.isArray(opts.onlyAudioNames) && opts.onlyAudioNames.length
    ? new Set(opts.onlyAudioNames.map((n) => String(n)))
    : null;

  try {
    const settings = await getSettings(pool);
    if (!settings.audioParentPath || !settings.metadataParentPath) {
      throw new Error('Audio and metadata parent paths must be configured');
    }

    const dateStr = opts.targetDateStr || getTargetDateStr(settings);
    summary.dateFolder = dateStr;
    _runState.targetFolder = dateStr;
    _runState.targetDate = dateStr;
    const runLabel = onlyAudioNames
      ? `Retry-failed (${onlyAudioNames.size} files)`
      : (isResume ? 'Resume' : 'Run');
    log(`[AutoUpload] === ${runLabel} for ${dateStr} ===`);

    const csvPath = opts.metadataFile || resolveMetadataCsv(settings, dateStr);
    if (!csvPath) throw new Error(`Metadata CSV not found for folder ${dateStr}`);

    _runState.metadataFile = csvPath;
    statePath = getStateFilePath(csvPath);

    if (!isResume && opts.startFresh !== false && !onlyAudioNames) {
      clearPersistedState(statePath);
    }

    if (isResume && !onlyAudioNames) {
      const persisted = readPersistedState(statePath);
      if (!persisted || (persisted.status !== 'stopped' && persisted.status !== 'paused')) {
        throw new Error(`No paused/stopped run to resume for folder ${dateStr}`);
      }
      startIndex = typeof persisted.resumeFromIndex === 'number' ? persisted.resumeFromIndex : startIndex;
    }

    writePersistedState(statePath, {
      status: 'running',
      targetFolder: dateStr,
      metadataFile: csvPath,
      resumeFromIndex: startIndex,
      currentIndex: startIndex,
      startedAt: summary.startedAt,
      triggeredBy,
      retryFailedOnly: Boolean(onlyAudioNames),
    });

    const records = await readMetadata(csvPath);
    summary.totalFiles = onlyAudioNames
      ? records.filter((r) => onlyAudioNames.has(r.audio_name)).length
      : records.length;

    const csvStatusOf = (rec) => String(rec.status || '').trim().toLowerCase();
    const isFailStatus = (rec) => {
      const s = csvStatusOf(rec);
      return s === 'fail' || s === 'failed';
    };

    _runState.items = records.map((rec, idx) => {
      const inRetrySet = !onlyAudioNames || onlyAudioNames.has(rec.audio_name);
      const priorDone = !onlyAudioNames && idx < startIndex;
      let status = 'pending';
      let stage = 'Queued';
      let reason = '';
      if (!inRetrySet) {
        status = 'skipped';
        stage = 'Done';
        reason = 'Not in retry-failed set';
      } else if (priorDone) {
        status = rec.status ? (isFailStatus(rec) ? 'pending' : 'skipped') : 'succeeded';
        stage = 'Done';
        reason = isFailStatus(rec) ? '' : (rec.failure_reason || 'Completed before resume');
      } else if (rec.status && !isFailStatus(rec)) {
        status = 'skipped';
        stage = 'Done';
        reason = rec.failure_reason || 'already_processed';
      }
      return {
        index: idx + 1,
        file: rec.audio_name,
        agent: rec.employee_name,
        callDate: rec.call_date || '',
        status,
        stage,
        reason,
        startedAt: null,
        finishedAt: null,
        durationSec: null,
        stages: [],
        message: '',
      };
    });
    recalcRunCounts();
    log(`[AutoUpload] ${records.length} records in ${csvPath}${startIndex > 0 ? ` (starting at index ${startIndex})` : ''}${onlyAudioNames ? ` — retry set ${onlyAudioNames.size}` : ''}`);

    let haltedAtIndex = null; // next index to resume from
    let haltReason = null; // 'pause' | 'abort'

    const journal = openAdmissionJournal(csvPath);
    const duplicateIndices = duplicateCsvIndices(records);
    const { effectiveMaxConcurrentJobs } = require('./aiEntitlement');
    const overlap = overlapEnabled() && effectiveMaxConcurrentJobs() !== 1;
    const feeder = await runStageFeeder({
      startIndex, length: records.length, enabled: overlap, shouldStop: isStopRequested,
      run: async (i, context) => {
        const rec = records[i];
        if (onlyAudioNames && !onlyAudioNames.has(rec.audio_name)) return { excluded: true };
        if (duplicateIndices.has(i)) return { skipped: true, duplicateCsv: true,
          reason: 'Duplicate audio name in metadata; first occurrence owns processing', durationSec: 0 };
        _runState.currentIndex = Math.max(_runState.currentIndex, i + 1);
        if (rec.status && !(onlyAudioNames && isFailStatus(rec))) {
          if (!(await reconcileCompletedCsv(pool, rec, journal))) return { stopped: true,
            reason: 'CSV completion and retained AI ownership need reconciliation.' };
          return { skipped: true, reason: rec.failure_reason || 'already_processed', durationSec: 0 };
        }
        setCurrentFile(rec, 'Starting');
        context.journal = journal;
        context.overlap = overlap;
        context.retryFailed = Boolean(onlyAudioNames);
        return processRecord(pool, rec, csvPath, records, settings,
          ({ stage, message }) => setCurrentFile(rec, stage, message), context);
      },
      finish: async (i, r, error) => {
        const rec = records[i];
        if (r?.excluded) return;
        if (error || r?.stopped) {
          haltedAtIndex = haltedAtIndex == null ? i : Math.min(haltedAtIndex, i);
          haltReason = isAbortRequested() ? 'abort' : 'pause';
          if (!isStopRequested()) _haltMode = 'pause';
          updateRunItem(rec.audio_name, {
            status: 'paused', stage: 'Awaiting reconciliation',
            reason: r?.reason || error?.message || 'Call retained for safe resume',
            message: 'Resume reconciles retained ownership before any dispatch',
            finishedAt: new Date().toISOString(),
          });
          return;
        }
        summary.processed++;
        const finishedAt = new Date().toISOString();
        const durationSec = typeof r.durationSec === 'number' ? r.durationSec : null;
        const reason = r.reason || (r.success ? 'Success' : 'Failed');
        let status;
        if (r.skipped) {
          summary.skipped++;
          status = 'skipped';
          summary.errors.push({ file: rec.audio_name, agent: rec.employee_name, reason, durationSec, type: status });
        } else if (r.success) {
          summary.succeeded++;
          status = 'succeeded';
        } else {
          summary.failed++;
          status = 'failed';
          summary.errors.push({ file: rec.audio_name, agent: rec.employee_name, reason, durationSec, type: status });
        }
        if (r.duplicateCsv) {
          const previousRecord = { ...records[i] };
          Object.assign(records[i], { status: 'Skipped', failure_reason: reason, processing_time: '0' });
          try { writeMetadata(csvPath, records); } catch (error) {
            Object.assign(records[i], previousRecord);
            throw error;
          }
          Object.assign(_runState.items[i], { status, stage: 'Done', reason, finishedAt, durationSec });
          recalcRunCounts();
        } else updateRunItem(rec.audio_name, { status, stage: 'Done', reason, finishedAt, durationSec });
        const activeItem = _runState.items.find((item) => item.status === 'processing');
        if (activeItem) {
          _runState.currentFile = { audio_name: activeItem.file, employee_name: activeItem.agent,
            stage: activeItem.stage, message: activeItem.message, startedAt: activeItem.startedAt };
        }
      },
    });
    for (const failure of feeder.completionErrors) {
      summary.processed = Math.max(0, summary.processed - 1);
      if (failure.result?.skipped) summary.skipped = Math.max(0, summary.skipped - 1);
      else if (failure.result?.success) summary.succeeded = Math.max(0, summary.succeeded - 1);
      else summary.failed = Math.max(0, summary.failed - 1);
      Object.assign(_runState.items[failure.index], { status: 'paused', stage: 'Awaiting reconciliation',
        reason: `Completion bookkeeping failed: ${failure.error.message}` });
      recalcRunCounts();
    }
    if (feeder.halted) {
      haltedAtIndex = haltedAtIndex ?? feeder.resumeFromIndex;
      haltReason = haltReason || (isAbortRequested() ? 'abort' : 'pause');
    }

    if (haltedAtIndex !== null || isStopRequested()) {
      const resumeFromIndex = haltedAtIndex ?? startIndex;
      haltReason = haltReason || (isAbortRequested() ? 'abort' : 'pause');
      summary.status = haltReason === 'pause' ? 'paused' : 'stopped';
      const nowIso = new Date().toISOString();
      if (haltReason === 'pause') _runState.pausedAt = nowIso;
      _runState.stoppedAt = nowIso;
      _runState.resumeFromIndex = resumeFromIndex;
      _runState.canResume = resumeFromIndex < records.length;
      _runState.haltMode = haltReason;
      writePersistedState(statePath, {
        status: summary.status,
        haltMode: haltReason,
        targetFolder: dateStr,
        metadataFile: csvPath,
        resumeFromIndex,
        lastCompletedIndex: Math.max(0, resumeFromIndex - 1),
        currentIndex: _runState.currentIndex,
        stoppedAt: _runState.stoppedAt,
        pausedAt: _runState.pausedAt,
        total: records.length,
        triggeredBy,
        counts: _runState.counts,
        items: _runState.items,
      });
      log(`[AutoUpload] ${summary.status} — resume at ${resumeFromIndex + 1}/${records.length}`);
    } else {
      summary.status = summary.failed > 0 ? 'completed_with_errors' : 'completed';
      clearPersistedState(statePath);
      _runState.canResume = false;
      _runState.resumeFromIndex = null;
    }

  } catch (err) {
    summary.status = isStopRequested()
      ? (isPauseRequested() ? 'paused' : 'stopped')
      : 'failed';
    summary.errors.push({
      file: null,
      agent: null,
      type: 'failed',
      reason: err.message || 'Run failed',
      stage: 'run',
    });
    log(`[AutoUpload] Run failed: ${err.message}`);
    if (isStopRequested() && statePath) {
      const nowIso = new Date().toISOString();
      _runState.stoppedAt = nowIso;
      if (isPauseRequested()) _runState.pausedAt = nowIso;
      _runState.canResume = true;
      _runState.resumeFromIndex = startIndex;
      writePersistedState(statePath, {
        status: summary.status,
        haltMode: isAbortRequested() ? 'abort' : 'pause',
        targetFolder: summary.dateFolder,
        metadataFile: _runState.metadataFile,
        resumeFromIndex: startIndex,
        stoppedAt: _runState.stoppedAt,
        pausedAt: _runState.pausedAt,
        total: _runState.total,
        triggeredBy,
        counts: _runState.counts,
      });
    }
  } finally {
    summary.completedAt     = new Date().toISOString();
    summary.durationSeconds = Math.round((Date.now() - t0) / 1000);
    _runState.status = summary.status;
    _runState.completedAt = summary.completedAt;
    _runState.durationSeconds = summary.durationSeconds;
    _runState.elapsedSeconds = summary.durationSeconds;
    _runState.currentFile = null;
    _runState.errors = summary.errors;
    _runState.haltRequested = false;
    recalcRunCounts();
    _running = false;
    _haltMode = null;
    await saveRunHistory(pool, summary);
    log(`[AutoUpload] === Finished: ${summary.status} (${summary.durationSeconds}s) ===`);
  }

  return summary;
}

async function validateResumeTarget(pool, targetFolder) {
  const settings = await getSettings(pool);
  const dateStr = targetFolder || getTargetDateStr(settings);
  const csvPath = resolveMetadataCsv(settings, dateStr);
  if (!csvPath) throw new Error(`Metadata CSV not found for folder ${dateStr}`);

  const statePath = getStateFilePath(csvPath);
  const persisted = readPersistedState(statePath);
  if (!persisted || (persisted.status !== 'stopped' && persisted.status !== 'paused')) {
    throw new Error(`No paused/stopped run to resume for folder ${dateStr}`);
  }
  return { dateStr, csvPath, resumeFromIndex: persisted.resumeFromIndex ?? 0 };
}

async function resumeAutoUpload(pool, dbConfig, opts = {}) {
  const validated = await validateResumeTarget(pool, opts.targetFolder);
  return runAutoUpload(pool, dbConfig, {
    triggeredBy: opts.triggeredBy || 'system',
    targetDateStr: validated.dateStr,
    metadataFile: validated.csvPath,
    resumeFromIndex: validated.resumeFromIndex,
    isResume: true,
  });
}

/**
 * Collect Fail/Failed CSV audio names (+ last in-memory failed items) for a folder.
 */
async function listFailedForRetry(pool, targetFolder) {
  const settings = await getSettings(pool);
  if (!settings.audioParentPath || !settings.metadataParentPath) {
    throw new Error('Audio and metadata parent paths must be configured');
  }
  const dateStr = targetFolder || getTargetDateStr(settings);
  const csvPath = resolveMetadataCsv(settings, dateStr);
  if (!csvPath) throw new Error(`Metadata CSV not found for folder ${dateStr}`);

  const records = await readMetadata(csvPath);
  const names = new Set();
  for (const rec of records) {
    const s = String(rec.status || '').trim().toLowerCase();
    if ((s === 'fail' || s === 'failed') && rec.audio_name) names.add(rec.audio_name);
  }
  if (_runState.targetFolder === dateStr || _runState.targetDate === dateStr) {
    for (const item of _runState.items) {
      if (item.status === 'failed' && item.file) names.add(item.file);
    }
  }
  return { dateStr, csvPath, names: [...names] };
}

/**
 * Re-process only CSV rows marked Fail/Failed (plus any failed items from the
 * last in-memory run for the same folder). Skips Success/Skipped rows.
 */
async function retryFailedAutoUpload(pool, dbConfig, opts = {}) {
  if (isRunActive()) {
    throw new Error('An auto-upload run is already in progress');
  }
  const listed = await listFailedForRetry(pool, opts.targetFolder || opts.targetDateStr);
  if (listed.names.length === 0) {
    throw new Error(`No failed files to retry in folder ${listed.dateStr}`);
  }

  log(`[AutoUpload] Retry-failed: ${listed.names.length} file(s) in ${listed.dateStr}`);
  return runAutoUpload(pool, dbConfig, {
    triggeredBy: opts.triggeredBy || 'system',
    targetDateStr: listed.dateStr,
    metadataFile: listed.csvPath,
    onlyAudioNames: listed.names,
    startFresh: false,
    isResume: false,
  });
}

function isRunInProgress() {
  return isRunActive();
}

async function getRunStatus(pool) {
  const status = cloneRunState();
  let stoppedRuns = [];

  try {
    if (pool) {
      const settings = await getSettings(pool);
      recoverStalePersistedRuns(settings.metadataParentPath);
      stoppedRuns = listStoppedRuns(settings.metadataParentPath);
    }
  } catch { /* non-fatal */ }

  if ((status.status === 'idle' || status.status === 'paused' || status.status === 'stopped')
      && stoppedRuns.length > 0 && !status.canResume) {
    const latest = stoppedRuns[0];
    status.canResume = true;
    status.resumeFromIndex = latest.resumeFromIndex;
    status.targetFolder = latest.targetFolder;
    status.stoppedAt = latest.stoppedAt;
    status.status = status.status === 'idle' ? (latest.status || 'paused') : status.status;
    status.total = latest.total;
    status.haltMode = latest.haltMode || null;
    if (latest.counts) status.counts = { ...status.counts, ...latest.counts };
  }

  // Keep live elapsed / provisional ETA ticking for the dashboard while active.
  if (status.status === 'running' && status.startedAt) {
    recalcRunCounts();
    const fresh = cloneRunState();
    status.elapsedSeconds = fresh.elapsedSeconds;
    status.avgSuccessSeconds = fresh.avgSuccessSeconds;
    status.estimateCallSeconds = fresh.estimateCallSeconds;
    status.avgSource = fresh.avgSource;
    status.etaSeconds = fresh.etaSeconds;
    status.counts = fresh.counts;
  }

  return { ...status, stoppedRuns };
}

/* ===================================================================
   Scheduler
   =================================================================== */

async function refreshScheduler(pool) {
  if (_cronJob) { _cronJob.stop(); _cronJob = null; }
  const settings = await getSettings(pool);
  if (!settings.enabled || !settings.cronSchedule) {
    log('[AutoUpload] Scheduler disabled');
    return { scheduled: false };
  }
  if (!cron.validate(settings.cronSchedule)) {
    log(`[AutoUpload] Invalid cron: ${settings.cronSchedule}`);
    return { scheduled: false };
  }
  _cronJob = cron.schedule(settings.cronSchedule, async () => {
    log('[AutoUpload] Cron triggered');
    try {
      const p = await dbPools.getActiveOrgPool();
      await runAutoUpload(p, null, { triggeredBy: 'cron' });
    } catch (err) {
      log(`[AutoUpload] Cron run error: ${err.message}`);
    }
  }, { timezone: IST });
  log(`[AutoUpload] Scheduler armed: "${settings.cronSchedule}" (IST)`);
  return { scheduled: true, expression: settings.cronSchedule };
}

async function initAutoUpload(pool) {
  await ensureHistoryTable(pool);
  try {
    const settings = await getSettings(pool);
    recoverStalePersistedRuns(settings.metadataParentPath);
  } catch { /* ignore */ }
  return refreshScheduler(pool);
}

/* ===================================================================
   Utility
   =================================================================== */

function log(msg) {
  const ts = moment().tz(IST).format('YYYY-MM-DD HH:mm:ss');
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Verify a path exists inside the backend container (after host→mount rewrite).
 * @param {string} inputPath
 * @param {"read"|"write"} mode
 * @param {"audio"|"metadata"|"any"} kind
 */
function probePath(inputPath, mode = 'read', kind = 'any') {
  const resolved = resolveBatchPath(inputPath, kind);
  const normalized = normalizeSlashes(resolved.path);
  if (!normalized) {
    return { ok: false, message: 'Path is required.' };
  }

  if (!fs.existsSync(normalized)) {
    const hint = resolved.mapped
      ? ` Mapped host path to "${normalized}", but that mount is missing inside the backend container.`
        + ` Check docker-compose volume BATCH_AUDIO_HOST / BATCH_METADATA_HOST and recreate backend.`
      : ` Auto Upload runs inside the backend container — use`
        + ` /app/data/batch_audio and /app/data/batch_metadata`
        + ` (host folders volumes/batch/audio and volumes/batch/metadata are already mounted there),`
        + ` or paste the host path under …/volumes/batch/… and it will be rewritten.`;
    return {
      ok: false,
      message: `Path does not exist: ${normalized}.${hint}`,
      path: normalized,
      rewrittenFrom: resolved.rewrittenFrom,
      mapped: resolved.mapped,
    };
  }

  let stat;
  try {
    stat = fs.statSync(normalized);
  } catch (err) {
    return {
      ok: false,
      message: `Cannot access path: ${err.message}`,
      path: normalized,
      rewrittenFrom: resolved.rewrittenFrom,
      mapped: resolved.mapped,
    };
  }

  if (!stat.isDirectory()) {
    return {
      ok: false,
      message: `Path is not a directory: ${normalized}`,
      path: normalized,
      rewrittenFrom: resolved.rewrittenFrom,
      mapped: resolved.mapped,
    };
  }

  const accessMode = mode === 'write'
    ? fs.constants.R_OK | fs.constants.W_OK
    : fs.constants.R_OK;

  try {
    fs.accessSync(normalized, accessMode);
  } catch (err) {
    const hint = mode === 'write'
      ? 'Directory is not readable/writable'
      : 'Directory is not readable';
    const code = err.code ? ` (${err.code})` : '';
    return {
      ok: false,
      message: `${hint}: ${normalized}${code}`,
      path: normalized,
      rewrittenFrom: resolved.rewrittenFrom,
      mapped: resolved.mapped,
    };
  }

  const accessLabel = mode === 'write' ? 'readable and writable' : 'readable';
  const rewriteNote = resolved.mapped
    ? ` (rewrote host path → ${normalized})`
    : '';
  return {
    ok: true,
    message: `OK — ${accessLabel} directory${rewriteNote}`,
    path: normalized,
    rewrittenFrom: resolved.rewrittenFrom,
    mapped: resolved.mapped,
  };
}

/* ===================================================================
   Public API
   =================================================================== */

module.exports = {
  getSettings,
  saveSettings,
  isRunInProgress,
  getRunStatus,
  requestStop,
  requestPause,
  requestAbort,
  runAutoUpload,
  resumeAutoUpload,
  retryFailedAutoUpload,
  listFailedForRetry,
  validateResumeTarget,
  getRunHistory,
  refreshScheduler,
  initAutoUpload,
  probePath,
  resolveBatchPath,
  processRecord,
  pollStatus,
};
