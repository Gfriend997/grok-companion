import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.env.GROK_SOURCE_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const { createApiClient } = await import(pathToFileURL(path.join(root, 'scripts/lib/api.mjs')));
const { main } = await import(pathToFileURL(path.join(root, 'scripts/grok-companion.mjs')));
const { toParts } = await import(pathToFileURL(path.join(root, 'scripts/lib/attach.mjs')));
const env = { XAI_API_KEY: 'test-key' };

test('malformed billable response is never resubmitted', async () => {
  let calls = 0;
  const api = createApiClient({ env, sleep: async () => {}, fetchImpl: async () => {
    calls++;
    return new Response('not JSON', { status: 200 });
  } });
  await assert.rejects(api.chat({ model: 'test', messages: [] }));
  assert.equal(calls, 1);
});

test('ambiguous transport failure is never resubmitted', async () => {
  let calls = 0;
  const api = createApiClient({ env, sleep: async () => {}, fetchImpl: async () => {
    calls++;
    throw new TypeError('connection lost after submission');
  } });
  await assert.rejects(api.chat({ model: 'test', messages: [] }));
  assert.equal(calls, 1);
});

test('already canceled API request does not reach fetch', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const api = createApiClient({ env, fetchImpl: async () => {
    calls++;
    return new Response('{"data":[]}');
  } });
  await assert.rejects(api.listModels({ signal: controller.signal }));
  assert.equal(calls, 0);
});

function harness() {
  const calls = [];
  const output = [];
  const deps = { env, stdout: { write: line => output.push(line) }, api: {
    chat: async input => { calls.push(input); return { content: 'answer' }; },
    respond: async input => { calls.push(input); return { content: 'answer', citations: [] }; }
  } };
  return { calls, output, deps };
}

test('CLI forwards the requested output limit', async () => {
  const h = harness();
  assert.equal(await main(['ask', '--max-tokens', '10', 'hello'], h.deps), 0);
  assert.equal(h.calls[0].maxTokens, 10);
});

test('CLI rejects unsupported flags before spending', async () => {
  const h = harness();
  assert.equal(await main(['ask', '--unknown', 'value', 'hello'], h.deps), 9);
  assert.equal(h.calls.length, 0);
});

test('CLI validates citation limits before spending', async () => {
  const h = harness();
  assert.equal(await main(['ask', '--live', '--max-sources', '0', 'hello'], h.deps), 9);
  assert.equal(h.calls.length, 0);
});

test('long-context check includes the task prompt', async () => {
  const h = harness();
  assert.equal(await main(['ask', 'a'.repeat(800_000)], h.deps), 9);
  assert.equal(h.calls.length, 0);
});

test('credential filenames are rejected even with image magic bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-review-'));
  try {
    const file = path.join(dir, '.env.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.throws(() => toParts([file]), /credential/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('implicit review includes staged changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-review-'));
  try {
    const git = args => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    git(['init']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'original');
    git(['add', 'a.txt']);
    git(['commit', '-m', 'initial']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'xai-' + 'A'.repeat(32));
    git(['add', 'a.txt']);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/grok-companion.mjs'), 'review'], {
      cwd: dir, env: { ...process.env, XAI_API_KEY: '' }, encoding: 'utf8'
    });
    assert.match(JSON.parse(result.stdout).message, /secret-shaped/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
