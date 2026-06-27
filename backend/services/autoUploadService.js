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

const { executePythonScript } = require('../pythonScriptHandler');
const { resolveProjectPath } = require('../projectPaths');

const IST = 'Asia/Kolkata';

const SETTING_KEY = 'auto_upload_config';

let _running        = false;
let _stopRequested  = false;
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
    currentIndex: 0,
    total: 0,
    resumeFromIndex: null,
    canResume: false,
    currentFile: null,
    counts: { total: 0, pending: 0, succeeded: 0, skipped: 0, failed: 0 },
    items: [],
    triggeredBy: '',
    durationSeconds: 0,
    errors: [],
  };
}

function isStopRequested() {
  return _stopRequested;
}

function isRunActive() {
  return _running || _runState.status === 'running';
}

function requestStop() {
  if (!isRunActive()) return false;
  _stopRequested = true;
  log('[AutoUpload] Stop requested');
  return true;
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
    if (data && data.status === 'stopped') {
      runs.push({
        targetFolder: data.targetFolder || '',
        metadataFile: data.metadataFile || '',
        resumeFromIndex: data.resumeFromIndex ?? 0,
        lastCompletedIndex: data.lastCompletedIndex ?? 0,
        stoppedAt: data.stoppedAt || null,
        total: data.total ?? 0,
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

function recalcRunCounts() {
  const c = { total: _runState.items.length, pending: 0, succeeded: 0, skipped: 0, failed: 0 };
  for (const item of _runState.items) {
    if (item.status === 'pending' || item.status === 'processing') c.pending++;
    else if (item.status === 'succeeded') c.succeeded++;
    else if (item.status === 'skipped') c.skipped++;
    else if (item.status === 'failed') c.failed++;
  }
  _runState.counts = c;
  _runState.total = c.total;
}

function findRunItem(file) {
  return _runState.items.find((i) => i.file === file);
}

function updateRunItem(file, patch) {
  const item = findRunItem(file);
  if (item) Object.assign(item, patch);
  recalcRunCounts();
}

function setCurrentFile(record, stage, message = '') {
  _runState.currentFile = {
    audio_name: record.audio_name,
    employee_name: record.employee_name,
    stage,
    message,
  };
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
    return { ...defaultSettings(), ...JSON.parse(r.recordset[0].SettingValue) };
  } catch {
    return defaultSettings();
  }
}

async function saveSettings(pool, body, username) {
  const current = await getSettings(pool);
  const merged  = {
    audioParentPath:    (body.audioParentPath    ?? current.audioParentPath).trim(),
    metadataParentPath: (body.metadataParentPath ?? current.metadataParentPath).trim(),
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
    const r = await pool.request()
      .input('name', sql.NVarChar, name)
      .query(
        `SELECT TOP 1 agent_name FROM dbo.Agents
         WHERE LOWER(agent_name) = LOWER(@name) AND is_active = 1`
      );
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
      .query('SELECT TOP 1 AudioFileName FROM dbo.AudioUploads WHERE AudioFileName LIKE @pat');
    return r.recordset.length > 0;
  } catch {
    return false;
  }
}

/* ===================================================================
   Poll processing status
   =================================================================== */

async function pollStatus(pool, audioFileName, maxMs = 600000, interval = 5000, shouldStop = () => false) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (shouldStop()) return { status: 'Stopped', error: null, stopped: true };
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
  return { status: 'Fail', error: `Timeout after ${maxMs / 1000}s` };
}

/* ===================================================================
   Resolve file paths
   =================================================================== */

function resolveAudioPath(record, settings) {
  const d = record.call_date;
  const candidates = [
    path.join(settings.audioParentPath, d, record.audio_name),
    path.join(settings.audioParentPath, d.replace(/-/g, '_'), record.audio_name),
    path.join(settings.audioParentPath, record.audio_name),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveMetadataCsv(settings, dateStr) {
  const candidates = [
    path.join(settings.metadataParentPath, dateStr, `metadata_${dateStr}.csv`),
    path.join(settings.metadataParentPath, `metadata_${dateStr}.csv`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* ===================================================================
   Process one audio record
   =================================================================== */

async function processRecord(pool, record, csvPath, allRecords, settings, onProgress, shouldStop = () => false) {
  const tag = `[AutoUpload] ${record.audio_name}`;
  const progress = (stage, message = '') => {
    onProgress?.({ stage, message });
  };

  if (shouldStop()) return { stopped: true };

  if (record.status) {
    progress('Done', 'Already processed in CSV');
    log(`${tag}: skip (status="${record.status}")`);
    return { skipped: true, reason: 'already_processed' };
  }

  progress('Checking agent');
  if (shouldStop()) return { stopped: true };
  if (!(await validateAgent(pool, record.employee_name))) {
    progress('Done', 'Agent not in active list');
    log(`${tag}: agent "${record.employee_name}" not active`);
    Object.assign(record, { status: 'Fail', failure_reason: 'Agent not in active list', processing_time: '0' });
    writeMetadata(csvPath, allRecords);
    return { skipped: false, success: false, reason: 'agent_not_found' };
  }

  progress('Resolving audio');
  if (shouldStop()) return { stopped: true };
  const audioPath = resolveAudioPath(record, settings);
  if (!audioPath) {
    progress('Done', 'Audio file not found');
    log(`${tag}: audio file not found`);
    Object.assign(record, { status: 'Fail', failure_reason: 'Audio file not found', processing_time: '0' });
    writeMetadata(csvPath, allRecords);
    return { skipped: false, success: false, reason: 'file_not_found' };
  }

  progress('Checking duplicate');
  if (shouldStop()) return { stopped: true };
  if (await isAlreadyUploaded(pool, record.audio_name)) {
    progress('Done', 'Already uploaded');
    log(`${tag}: dedup skip`);
    Object.assign(record, { status: 'Skipped', failure_reason: 'Already uploaded', processing_time: '0' });
    writeMetadata(csvPath, allRecords);
    return { skipped: true, reason: 'already_uploaded' };
  }

  const t0           = Date.now();
  const destFileName = `${Date.now()}-${record.audio_name}`;
  const destPath     = path.join(uploadDirectory, destFileName);

  try {
    progress('Copying audio');
    if (shouldStop()) return { stopped: true };
    fs.copyFileSync(audioPath, destPath);
    log(`${tag}: copied → ${destFileName}`);

    if (shouldStop()) {
      await cleanupPartialUpload(pool, null, destPath);
      return { stopped: true };
    }

    progress('Uploading');
    await pool.request()
      .input('fileName', sql.NVarChar, destFileName)
      .input('agent',    sql.NVarChar, record.employee_name)
      .input('callDate', sql.Date,     reformatDateForSql(record.call_date))
      .input('callType', sql.NVarChar, (record.audio_type || 'inbound').toLowerCase())
      .query(`
        INSERT INTO dbo.AudioUploads
          (AudioFileName, SelectedAgent, SelectedCallDate, CallType, ProcessStatus, UploadDate)
        VALUES
          (@fileName, @agent, @callDate, @callType, 'Pending', GETDATE())
      `);

    if (shouldStop()) {
      await cleanupPartialUpload(pool, destFileName, destPath);
      return { stopped: true };
    }

    progress('Waiting for AI');
    await new Promise((resolve) => {
      executePythonScript('', [destFileName], (code) => {
        log(`${tag}: AI-Main code ${code}`);
        resolve(code);
      });
    });

    if (shouldStop()) {
      await cleanupPartialUpload(pool, destFileName, destPath);
      return { stopped: true };
    }

    const result  = await pollStatus(pool, destFileName, 600000, 5000, shouldStop);
    if (result.stopped) {
      await cleanupPartialUpload(pool, destFileName, destPath);
      return { stopped: true };
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    record.status          = result.status;
    record.processing_time = String(elapsed);
    record.failure_reason  = result.status === 'Fail' ? (result.error || 'Processing failed') : '';
    writeMetadata(csvPath, allRecords);
    progress('Done', result.status === 'Success' ? 'Success' : (result.error || 'Processing failed'));
    log(`${tag}: ${result.status} in ${elapsed}s`);
    return { skipped: false, success: result.status === 'Success', reason: result.status };

  } catch (err) {
    if (shouldStop()) {
      await cleanupPartialUpload(pool, destFileName, destPath);
      return { stopped: true };
    }
    progress('Done', err.message);
    log(`${tag}: error — ${err.message}`);
    Object.assign(record, { status: 'Fail', failure_reason: err.message, processing_time: '0' });
    writeMetadata(csvPath, allRecords);
    return { skipped: false, success: false, reason: err.message };
  }
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
      .input('errors',      sql.NVarChar,  JSON.stringify(r.errors || []))
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
  _stopRequested = false;
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
  };

  let statePath = null;
  let startIndex = typeof opts.resumeFromIndex === 'number' ? opts.resumeFromIndex : 0;

  try {
    const settings = await getSettings(pool);
    if (!settings.audioParentPath || !settings.metadataParentPath) {
      throw new Error('Audio and metadata parent paths must be configured');
    }

    const dateStr = opts.targetDateStr || getTargetDateStr(settings);
    summary.dateFolder = dateStr;
    _runState.targetFolder = dateStr;
    _runState.targetDate = dateStr;
    log(`[AutoUpload] === ${isResume ? 'Resume' : 'Run'} for ${dateStr} ===`);

    const csvPath = opts.metadataFile || resolveMetadataCsv(settings, dateStr);
    if (!csvPath) throw new Error(`Metadata CSV not found for folder ${dateStr}`);

    _runState.metadataFile = csvPath;
    statePath = getStateFilePath(csvPath);

    if (!isResume && opts.startFresh !== false) {
      clearPersistedState(statePath);
    }

    if (isResume) {
      const persisted = readPersistedState(statePath);
      if (!persisted || persisted.status !== 'stopped') {
        throw new Error(`No stopped run to resume for folder ${dateStr}`);
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
    });

    const records = await readMetadata(csvPath);
    summary.totalFiles = records.length;
    _runState.items = records.map((rec) => ({
      file: rec.audio_name,
      agent: rec.employee_name,
      status: rec.status ? 'skipped' : 'pending',
      stage: rec.status ? 'Done' : 'Queued',
      reason: rec.status ? 'already_processed' : '',
    }));
    recalcRunCounts();
    log(`[AutoUpload] ${records.length} records in ${csvPath}${startIndex > 0 ? ` (starting at index ${startIndex})` : ''}`);

    let stoppedAtIndex = null;

    for (let i = startIndex; i < records.length; i++) {
      if (isStopRequested()) {
        stoppedAtIndex = i;
        break;
      }

      const rec = records[i];
      _runState.currentIndex = i + 1;
      if (rec.status) {
        _runState.currentFile = {
          audio_name: rec.audio_name,
          employee_name: rec.employee_name,
          stage: 'Done',
          message: 'Already processed in CSV',
        };
      } else {
        setCurrentFile(rec, 'Starting');
      }

      try {
        const r = await processRecord(
          pool, rec, csvPath, records, settings,
          ({ stage, message }) => setCurrentFile(rec, stage, message),
          isStopRequested
        );

        if (r.stopped) {
          stoppedAtIndex = i;
          updateRunItem(rec.audio_name, {
            status: 'pending',
            stage: 'Stopped',
            reason: 'Run stopped by admin',
            message: 'Run stopped — will retry on resume',
          });
          break;
        }

        summary.processed++;
        const detail = { file: rec.audio_name, agent: rec.employee_name, reason: r.reason || '' };
        if (r.skipped) {
          summary.skipped++;
          summary.errors.push({ ...detail, type: 'skipped' });
          updateRunItem(rec.audio_name, {
            status: 'skipped',
            stage: 'Done',
            reason: r.reason || '',
          });
        } else if (r.success) {
          summary.succeeded++;
          updateRunItem(rec.audio_name, {
            status: 'succeeded',
            stage: 'Done',
            reason: r.reason || 'Success',
          });
        } else {
          summary.failed++;
          summary.errors.push({ ...detail, type: 'failed' });
          updateRunItem(rec.audio_name, {
            status: 'failed',
            stage: 'Done',
            reason: r.reason || '',
          });
        }
      } catch (err) {
        if (isStopRequested()) {
          stoppedAtIndex = i;
          updateRunItem(rec.audio_name, {
            status: 'pending',
            stage: 'Stopped',
            reason: 'Run stopped by admin',
          });
          break;
        }
        summary.processed++;
        summary.failed++;
        summary.errors.push({ file: rec.audio_name, agent: rec.employee_name, type: 'failed', reason: err.message });
        updateRunItem(rec.audio_name, {
          status: 'failed',
          stage: 'Done',
          reason: err.message,
        });
      }
    }

    if (stoppedAtIndex !== null || isStopRequested()) {
      const resumeFromIndex = stoppedAtIndex ?? startIndex;
      summary.status = 'stopped';
      _runState.stoppedAt = new Date().toISOString();
      _runState.resumeFromIndex = resumeFromIndex;
      _runState.canResume = true;
      writePersistedState(statePath, {
        status: 'stopped',
        targetFolder: dateStr,
        metadataFile: csvPath,
        resumeFromIndex,
        lastCompletedIndex: Math.max(0, resumeFromIndex - 1),
        currentIndex: _runState.currentIndex,
        stoppedAt: _runState.stoppedAt,
        total: records.length,
        triggeredBy,
        counts: _runState.counts,
      });
      log(`[AutoUpload] Stopped at index ${resumeFromIndex + 1}/${records.length}`);
    } else {
      summary.status = summary.failed > 0 ? 'completed_with_errors' : 'completed';
      clearPersistedState(statePath);
      _runState.canResume = false;
      _runState.resumeFromIndex = null;
    }

  } catch (err) {
    summary.status = isStopRequested() ? 'stopped' : 'failed';
    summary.errors.push(err.message);
    log(`[AutoUpload] Run failed: ${err.message}`);
    if (isStopRequested() && statePath) {
      _runState.stoppedAt = new Date().toISOString();
      _runState.canResume = true;
      _runState.resumeFromIndex = startIndex;
      writePersistedState(statePath, {
        status: 'stopped',
        targetFolder: summary.dateFolder,
        metadataFile: _runState.metadataFile,
        resumeFromIndex: startIndex,
        stoppedAt: _runState.stoppedAt,
        total: _runState.total,
        triggeredBy,
      });
    }
  } finally {
    summary.completedAt     = new Date().toISOString();
    summary.durationSeconds = Math.round((Date.now() - t0) / 1000);
    _runState.status = summary.status;
    _runState.completedAt = summary.completedAt;
    _runState.durationSeconds = summary.durationSeconds;
    _runState.currentFile = null;
    _runState.errors = summary.errors;
    recalcRunCounts();
    _running = false;
    _stopRequested = false;
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
  if (!persisted || persisted.status !== 'stopped') {
    throw new Error(`No stopped run to resume for folder ${dateStr}`);
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

  if (status.status === 'idle' && stoppedRuns.length > 0) {
    const latest = stoppedRuns[0];
    status.canResume = true;
    status.resumeFromIndex = latest.resumeFromIndex;
    status.targetFolder = latest.targetFolder;
    status.stoppedAt = latest.stoppedAt;
    status.total = latest.total;
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
      const p = await sql.connect();
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

/* ===================================================================
   Public API
   =================================================================== */

module.exports = {
  getSettings,
  saveSettings,
  isRunInProgress,
  getRunStatus,
  requestStop,
  runAutoUpload,
  resumeAutoUpload,
  validateResumeTarget,
  getRunHistory,
  refreshScheduler,
  initAutoUpload,
};
