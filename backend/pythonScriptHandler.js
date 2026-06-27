require('dotenv').config();

const { resolveProjectPath } = require('./projectPaths');
const { logCallEvent } = require('./services/callProcessingLog');
const { connectToDatabase } = require('./dbConnection');
const axios   = require('axios');

const fs      = require('fs');

const path    = require('path');

const moment  = require('moment-timezone');

const util    = require('util');



// ─────────────────────────────────────────────

// 1)  Log‑file initialisation

// ─────────────────────────────────────────────

const logDir  = resolveProjectPath(process.env.BACKEND_LOG_DIR || '/app/logs');

const logFile = path.join(logDir, process.env.PYTHON_SCRIPT_LOG_FILE || 'python_script.log');



if (!fs.existsSync(logDir)) {

  fs.mkdirSync(logDir, { recursive: true });

  console.log('[INFO] Log directory created:', logDir);

}



const writeLog = msg => {

  const ts = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

  fs.appendFileSync(logFile, `[${ts}] ${msg}\n`);

};



// ─────────────────────────────────────────────

// 2)  Remote / local routing

// ─────────────────────────────────────────────

const resolveAudioUploadDir = () => {

  const raw = process.env.AUDIO_UPLOAD_DIR || '';

  return resolveProjectPath(raw);

};



const isRemoteAiMain = () => {

  if (process.env.AI_MAIN_REMOTE === 'true') return true;

  const base = (process.env.AI_MAIN_URL || 'http://localhost:8000').replace(/\/$/, '');

  try {

    const host = new URL(base).hostname.toLowerCase();

    return host !== 'localhost' && host !== '127.0.0.1';

  } catch {

    return false;

  }

};



const orchestratorHeaders = () => {
  const secret = process.env.ORCHESTRATOR_SECRET;
  return secret ? { "X-Orchestrator-Secret": secret } : {};
};

const postLocalProcessAudio = async (aiMainBase, audioFile) => {

  const processUrl = `${aiMainBase}/process-audio`;

  writeLog(`[INFO] Target URL: ${processUrl}`);

  return axios.post(processUrl, { audioFile }, { timeout: 30_000, headers: orchestratorHeaders() });

};



const postRemoteUploadAndProcess = async (aiMainBase, audioFile) => {

  const uploadDir = resolveAudioUploadDir();

  const audioPath = path.join(uploadDir, audioFile);



  if (!fs.existsSync(audioPath)) {

    throw new Error(`Audio file not found on laptop: ${audioPath}`);

  }



  const processUrl = `${aiMainBase}/upload-and-process`;

  writeLog(`[INFO] Remote GPU upload URL: ${processUrl}`);



  const fileBuffer = fs.readFileSync(audioPath);

  const form = new FormData();

  form.append('audio', new Blob([fileBuffer]), audioFile);

  form.append('audioFile', audioFile);



  return axios.post(processUrl, form, {

    timeout: 120_000,

    maxBodyLength: Infinity,

    maxContentLength: Infinity,

    headers: orchestratorHeaders(),

  });

};



// ─────────────────────────────────────────────

// 3)  Main helper

// ─────────────────────────────────────────────

const executePythonScript = async (scriptPath, args = [], cb) => {



  if (!args?.length || !args[0]) {

    writeLog('[ERROR] No audio file provided for processing');

    return cb && cb(1);

  }



  const audioFile = args[0];

  const aiMainBase = (process.env.AI_MAIN_URL || 'http://localhost:8000').replace(/\/$/, '');

  const remote = isRemoteAiMain();



  writeLog(`[INFO] Initiating audio processing for file: ${audioFile}`);

  writeLog(`[INFO] Mode: ${remote ? 'remote GPU (multipart upload)' : 'local (JSON)'}`);

  let pool = null;
  try {
    pool = await connectToDatabase();
  } catch (dbErr) {
    writeLog(`[WARN] DB unavailable for call processing log: ${dbErr.message}`);
  }

  await logCallEvent(pool, {
    audioFile,
    stage: 'dispatch',
    message: `Dispatching to AI (${remote ? 'remote GPU upload' : 'local JSON'})`,
    level: 'INFO',
  });

  try {

    const resp = remote

      ? await postRemoteUploadAndProcess(aiMainBase, audioFile)

      : await postLocalProcessAudio(aiMainBase, audioFile);



    writeLog(`[INFO] Response status ${resp.status}`);

    writeLog(`[INFO] Response data: ${JSON.stringify(resp.data)}`);



    if (resp.status === 200 && resp.data.success) {

      writeLog('[INFO] Audio processed successfully');
      await logCallEvent(pool, {
        audioFile,
        stage: 'dispatch',
        message: 'AI dispatch accepted',
        level: 'INFO',
      });

      return cb && cb(0);

    }



    writeLog('[ERROR] Unsuccessful response from AI‑Main');
    await logCallEvent(pool, {
      audioFile,
      stage: 'dispatch',
      message: 'Unsuccessful response from AI-Main',
      level: 'ERROR',
      detail: JSON.stringify(resp.data),
    });

    return cb && cb(1);



  } catch (error) {



    writeLog(`[ERROR] Failed to communicate with AI‑Main: ${error.message}`);

    let detail = error.message;
    if (error.response) {

      writeLog(`[ERROR] Response status: ${error.response.status}`);

      writeLog(`[ERROR] Response data: ${JSON.stringify(error.response.data)}`);
      detail = `status=${error.response.status} ${JSON.stringify(error.response.data)}`;

    } else if (error.request) {

      writeLog('[ERROR] No response received from AI‑Main container');

      writeLog(`[ERROR] Request details: ${util.inspect(error.request, { depth: 1 })}`);
      detail = 'No response received from AI-Main';

    } else {

      writeLog('[ERROR] Error setting up request');

    }

    await logCallEvent(pool, {
      audioFile,
      stage: 'dispatch',
      message: `Failed to communicate with AI-Main: ${error.message}`,
      level: 'ERROR',
      detail,
    });

    return cb && cb(1);

  }

};



module.exports = { executePythonScript };


