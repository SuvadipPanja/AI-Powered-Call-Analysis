/**
 * Session-memory cache for the official ICICI HFC quality workbook.
 * Never writes to disk (no localStorage / IndexedDB). Cleared on logout.
 */
const MAX_ENTRIES = 3;
const store = new Map();
const inflight = new Map();

export function qualityWorkbookCacheKey(username, params = {}) {
  return [
    String(username || "anon"),
    String(params.fromDate || ""),
    String(params.toDate || ""),
    String(params.location || "All"),
    String(params.tl || "All"),
    String(params.agent || "All"),
    String(params.callType || "All"),
  ].join("|");
}

export function getQualityWorkbook(key) {
  if (!key || !store.has(key)) return null;
  const blob = store.get(key);
  store.delete(key);
  store.set(key, blob);
  return blob;
}

export function setQualityWorkbook(key, blob) {
  if (!key || !blob) return;
  if (store.has(key)) store.delete(key);
  store.set(key, blob);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

export function takeQualityWorkbookWork(key, start) {
  const cached = getQualityWorkbook(key);
  if (cached) {
    return Promise.resolve({ cached: true, blob: cached });
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const work = Promise.resolve()
    .then(start)
    .then((blob) => {
      setQualityWorkbook(key, blob);
      return { cached: false, blob };
    })
    .finally(() => {
      if (inflight.get(key) === work) inflight.delete(key);
    });
  inflight.set(key, work);
  return work;
}

export function clearQualityWorkbookCache() {
  store.clear();
  inflight.clear();
}

export function qualityWorkbookCacheSize() {
  return store.size;
}
