/** Admission transport only. A lost acknowledgement is never permission to replay. */
function identityMatches(data, audioFile, runId) {
  return data?.runId === runId && data.audioFile === audioFile
    && typeof data.controllerInstanceId === 'string' && data.controllerInstanceId.length > 0;
}

function classifyResponse(response, audioFile, runId, { legacy = false } = {}) {
  const data = response?.data || {};
  const status = Number(response?.status || 0);
  if (status === 200 && data.success === true && (data.accepted === true || legacy)) {
    if (!legacy && !identityMatches(data, audioFile, runId)) {
      return { kind: 'unknown', reason: 'AI acknowledgement identity mismatch.' };
    }
    return { ...data, kind: 'accepted' };
  }
  // The live controller starts the job and returns { success: true, message }
  // with no admission receipt and no /job-status. That is acceptance, not a
  // lost acknowledgement. Pausing here left the call running while the queue
  // showed "AI acceptance could not be established."
  if (status === 200 && data.success === true && data.accepted == null
      && (typeof data.controllerInstanceId !== 'string' || data.controllerInstanceId.length === 0)) {
    return { ...data, kind: 'accepted', accepted: true, legacyController: true };
  }
  if (data.accepted === false && data.retryable === true
      && (status === 429 || (status === 503 && data.code === 'AI_START_FAILED'))) {
    return { ...data, kind: 'retryable', reason: data.reason || 'AI capacity is full.' };
  }
  if (data.code === 'CONTROLLER_RESTARTED' || data.code === 'AI_FILE_BUSY') {
    return { ...data, kind: 'unknown', reason: data.reason || 'AI ownership needs reconciliation.' };
  }
  if (data.accepted === false && data.retryable === false && status >= 400 && status < 500) {
    return { ...data, kind: 'rejected', reason: data.reason || 'AI rejected this request.' };
  }
  return { kind: 'unknown', reason: 'AI acceptance could not be established.' };
}

async function readJobStatus({ get, base, audioFile, runId, headers }) {
  try {
    const response = await get(`${base}/job-status`, {
      params: { audioFile, runId }, headers, timeout: 10000,
      validateStatus: () => true,
    });
    const data = response.data || {};
    if (response.status === 200 && data.known === true && identityMatches(data, audioFile, runId)) {
      return { ...data, kind: 'known' };
    }
    return { kind: 'unknown', controllerInstanceId: data.controllerInstanceId,
      reason: response.status === 404 ? 'Run is not known to this controller.' : 'AI status unavailable.' };
  } catch {
    return { kind: 'unknown', reason: 'AI status unavailable.' };
  }
}

async function submitOnce({ submit, reconcile, audioFile, runId, legacy = false }) {
  let outcome;
  try {
    outcome = classifyResponse(await submit(), audioFile, runId, { legacy });
  } catch (error) {
    outcome = error.response
      ? classifyResponse(error.response, audioFile, runId, { legacy })
      : { kind: 'unknown', reason: 'AI acknowledgement was not received.' };
  }
  if (outcome.kind !== 'unknown' || !runId) return outcome;
  const status = await reconcile();
  if (status.kind === 'known') return { ...status, kind: 'accepted', accepted: true, reconciled: true };
  return { ...outcome, kind: 'unknown' };
}

function overlapEnabled(env = process.env) {
  return env.AUTO_UPLOAD_STAGE_OVERLAP_ENABLED === 'true';
}

function canStartSuccessor(active, enabled) {
  if (!active.length) return true;
  if (!enabled || active.length >= 2) return false;
  // Only authoritative per-run ASR release admits the single successor.
  return active.every((job) => job.asrComplete === true && job.accepted === true);
}

module.exports = { classifyResponse, readJobStatus, submitOnce, overlapEnabled, canStartSuccessor };
