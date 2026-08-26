const test = require("node:test");
const assert = require("node:assert/strict");

test("buffer cache stores and returns the same bytes in memory", async () => {
  const cache = require("../services/cacheService");
  const key = `quality-test-${Date.now()}`;
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
  await cache.setBuffer(key, bytes, 30);
  const hit = await cache.getBuffer(key);
  assert.ok(Buffer.isBuffer(hit));
  assert.deepEqual([...hit], [...bytes]);
});

test("binary cache encodes Redis payloads as base64 so GET strings survive", () => {
  const { encodeCacheBuffer, decodeCacheBuffer } = require("../services/cacheService");
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
  const encoded = encodeCacheBuffer(bytes);
  assert.equal(typeof encoded, "string");
  assert.deepEqual([...decodeCacheBuffer(encoded)], [...bytes]);
  assert.deepEqual([...decodeCacheBuffer(bytes)], [...bytes]);
  assert.equal(decodeCacheBuffer(""), null);
});

test("buffer cache can be read back after the in-memory copy is dropped", async () => {
  const cache = require("../services/cacheService");
  const key = `quality-disk-${Date.now()}`;
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xaa]);
  await cache.setBuffer(key, bytes, 30);
  cache._memory.del(`bin:${key}`);
  const hit = await cache.getBuffer(key);
  assert.ok(Buffer.isBuffer(hit));
  assert.deepEqual([...hit], [...bytes]);
});
