import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMedia } from '../scripts/lib/media.mjs';
import { main } from '../scripts/grok-companion.mjs';

test('media download stops an oversized chunked response before draining it', { timeout: 1000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-stream-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let canceled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(11)); },
    cancel() { canceled = true; }
  });
  const media = createMedia({ fetchImpl: async () => new Response(body) });
  await assert.rejects(media.downloadArtifact('https://imgen.x.ai/a.jpg', dir, { maxBytes: 10 }), /too large/);
  assert.equal(canceled, true);
  assert.equal(fs.readdirSync(dir).length, 0);
});

test('media download times out while the body stalls', { timeout: 1000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-stream-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const media = createMedia({ fetchImpl: async (_url, init) => {
    const body = new ReadableStream({ start(controller) {
      init.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    } });
    return new Response(body);
  } });
  await assert.rejects(media.downloadArtifact('https://imgen.x.ai/a.jpg', dir, { timeoutMs: 10 }), /timed out|aborted/);
});

test('video creation requires confirmed cost before contacting the provider', async () => {
  let calls = 0;
  const code = await main(['video', '--seconds', '2', 'test'], {
    stdout: { write() {} }, media: { createVideoJob: async () => { calls++; } }
  });
  assert.equal(code, 9);
  assert.equal(calls, 0);
});

test('base64 images are verified and saved to the selected output path', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-base64-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = [];
  const media = createMedia({ apiClient: { requestAuthenticated: async () => ({ data: [{ b64_json: '/9j/2Q==' }] }) } });
  const out = path.join(dir, 'selected.jpg');
  const code = await main(['imagine', 'drawing', '--out', out], { media, stdout: { write: value => output.push(value) } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output[0]).path, out);
  assert.deepEqual(fs.readFileSync(out), Buffer.from('/9j/2Q==', 'base64'));
  assert.throws(() => media.saveBase64('not-base64', { out }), /base64/);
});

test('base64 image size is bounded before decoding', () => {
  const media = createMedia();
  assert.throws(() => media.saveBase64('A'.repeat(16), { maxBytes: 2 }), /too large/);
});
