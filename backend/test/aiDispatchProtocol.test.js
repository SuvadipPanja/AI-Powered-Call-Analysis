const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyResponse, submitOnce, readJobStatus, overlapEnabled, canStartSuccessor } = require('../services/aiDispatchProtocol');

const accepted = { status: 200, data: { success: true, accepted: true, runId: 'run-1', audioFile: 'call.wav', controllerInstanceId: 'instance-1' } };
test('new clients require affirmative admission and matching run identity', () => {
  assert.equal(classifyResponse(accepted, 'call.wav', 'run-1').kind, 'accepted');
  assert.equal(classifyResponse(accepted, 'call.wav', 'run-2').kind, 'unknown');
  const live = classifyResponse({ status: 200, data: { success: true, message: 'Audio processing started.' } }, 'call.wav', 'run-1');
  assert.equal(live.kind, 'accepted');
  assert.equal(live.legacyController, true);
  assert.equal(classifyResponse({ status: 200, data: { success: true } }, 'call.wav', '', { legacy: true }).kind, 'accepted');
});
test('only explicit capacity negative acknowledgements are retryable', () => {
  assert.equal(classifyResponse({ status: 429, data: { accepted: false, retryable: true } }).kind, 'retryable');
  assert.equal(classifyResponse({ status: 403, data: { accepted: false, retryable: false } }).kind, 'rejected');
  assert.equal(classifyResponse({ status: 503, data: {} }).kind, 'unknown');
  assert.equal(classifyResponse({ status: 503, data: { accepted: false, retryable: true, code: 'AI_START_FAILED' } }).kind, 'retryable');
  assert.equal(classifyResponse({ status: 503, data: { accepted: false, retryable: true, code: 'OTHER' } }).kind, 'unknown');
  assert.equal(classifyResponse({ status: 409, data: { accepted: false, retryable: false, code: 'AI_FILE_BUSY' } }).kind, 'unknown');
});

test('classification cannot be overridden by response data and requires controller identity', () => {
  assert.equal(classifyResponse({ ...accepted, data: { ...accepted.data, kind: 'unknown' } }, 'call.wav', 'run-1').kind, 'accepted');
  assert.equal(classifyResponse({ ...accepted, data: { ...accepted.data, controllerInstanceId: '' } }, 'call.wav', 'run-1').kind, 'unknown');
  assert.equal(classifyResponse({ ...accepted, data: { ...accepted.data, audioFile: undefined } }, 'call.wav', 'run-1').kind, 'unknown');
});
test('lost acknowledgement reconciles an accepted run without a second POST', async () => {
  let posts = 0;
  const result = await submitOnce({ audioFile: 'call.wav', runId: 'run-1', controllerInstanceId: 'instance-1',
    submit: async () => { posts++; throw new Error('ACK lost'); },
    reconcile: async () => ({ kind: 'known', runId: 'run-1', status: 'running' }),
  });
  assert.equal(result.kind, 'accepted');
  assert.equal(result.reconciled, true);
  assert.equal(posts, 1);
});
test('controller restart after lost acknowledgement stays unknown, never replayed', async () => {
  let posts = 0;
  const result = await submitOnce({ audioFile: 'call.wav', runId: 'run-1', controllerInstanceId: 'instance-1',
    submit: async () => { posts++; throw new Error('timeout'); },
    reconcile: async () => ({ kind: 'unknown', controllerInstanceId: 'new-process' }),
  });
  assert.equal(result.kind, 'unknown');
  assert.equal(posts, 1);
});
test('negative capacity ACK does not need uncertain-status reconciliation', async () => {
  const result = await submitOnce({ audioFile: 'call.wav', runId: 'run-1', controllerInstanceId: 'instance-1',
    submit: async () => ({ status: 429, data: { accepted: false, retryable: true } }),
    reconcile: async () => { throw new Error('must not reconcile'); },
  });
  assert.equal(result.kind, 'retryable');
});
test('authenticated status rejects mismatched identity and transport failures', async () => {
  let request;
  const result = await readJobStatus({ base: 'http://ai', audioFile: 'call.wav', runId: 'run-1', controllerInstanceId: 'instance-1', headers: { Authorization: 'test' },
    get: async (_url, options) => { request = options; return { status: 200, data: { known: true, runId: 'other', asrComplete: true } }; },
  });
  assert.equal(result.kind, 'unknown');
  assert.deepEqual(request.params, { audioFile: 'call.wav', runId: 'run-1' });
  assert.equal(request.headers.Authorization, 'test');
  assert.equal((await readJobStatus({ get: async () => { throw Error(); } })).kind, 'unknown');
});
test('overlap defaults off and requires actual ASR release with maximum two runs', () => {
  assert.equal(overlapEnabled({}), false);
  assert.equal(overlapEnabled({ AUTO_UPLOAD_STAGE_OVERLAP_ENABLED: 'TRUE' }), false);
  assert.equal(overlapEnabled({ AUTO_UPLOAD_STAGE_OVERLAP_ENABLED: 'true' }), true);
  assert.equal(canStartSuccessor([{ accepted: true, asrComplete: false }], true), false);
  assert.equal(canStartSuccessor([{ accepted: false, asrComplete: true }], true), false);
  assert.equal(canStartSuccessor([{ accepted: true, asrComplete: true }], false), false);
  assert.equal(canStartSuccessor([{ accepted: true, asrComplete: true }], true), true);
  assert.equal(canStartSuccessor(Array(2).fill({ accepted: true, asrComplete: true }), true), false);
});
