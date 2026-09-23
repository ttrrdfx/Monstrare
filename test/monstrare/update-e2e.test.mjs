import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createGitHubReleaseProvider, GITHUB_RELEASE_API_URL } from '../../scripts/lib/github-release.mjs';
import { readInstallManifest } from '../../scripts/lib/manifest.mjs';
import { buildReleaseBundle, serializeReleaseBundle } from '../../scripts/lib/release-bundle.mjs';
import { copyFixtureTree, materializeLegacyStockFixture, snapshotFixtureData } from './fixtures.mjs';
import { createUpgradeRequestHandler, createUpgradeService } from '../../tools/kanban/upgrade-api.mjs';

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const commit = 'a'.repeat(40);
const assetUrl = 'https://github.com/ttrrdfx/Monstrare/releases/download/v1.0.0/monstrare-v1.0.0.bundle.json';

async function fixture(t) {
  const targetRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'monstrare-task20-e2e-')));
  t.after(() => fs.rm(targetRoot, { recursive: true, force: true }));
  await materializeLegacyStockFixture({ sourceRoot, targetRoot });
  await copyFixtureTree('project-data', targetRoot);
  const bundle = serializeReleaseBundle(await buildReleaseBundle({ sourceRoot, createdFrom: commit }));
  const digest = crypto.createHash('sha256').update(bundle).digest('hex');
  const asset = {
    id: 2020,
    name: 'monstrare-v1.0.0.bundle.json',
    digest: `sha256:${digest}`,
    browser_download_url: assetUrl,
  };
  const requests = [];
  const provider = createGitHubReleaseProvider({
    transport: async (url, options) => {
      requests.push({ url, headers: options.headers });
      if (url === GITHUB_RELEASE_API_URL) {
        return new Response(JSON.stringify({
          id: 1020, draft: false, prerelease: false, tag_name: 'v1.0.0', assets: [asset],
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === assetUrl) return new Response(bundle);
      throw new Error('unexpected URL');
    },
  });
  const service = createUpgradeService({ targetRoot, provider });
  const handler = createUpgradeRequestHandler({
    service,
    sendJson(response, status, data) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(data));
    },
  });
  const server = createServer(async (request, response) => {
    if (!await handler(request, response, new URL(request.url, 'http://localhost').pathname)) {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await service.cleanup();
    await new Promise((resolve) => server.close(resolve));
  });
  return { targetRoot, requests, origin: `http://127.0.0.1:${server.address().port}` };
}

function request(origin, endpoint, body, extraHeaders = {}) {
  return fetch(`${origin}/api/upgrade/${endpoint}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

async function startUpgradedBoard(t, targetRoot) {
  const child = spawn(process.execPath, [path.join(targetRoot, 'tools/kanban/server.mjs')], {
    env: { ...process.env, KANBAN_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('upgraded board did not start')), 8_000);
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`upgraded board exited: ${code}`));
    });
  });
}

test('TASK-020 real bundle → fake GitHub → HTTP check/apply → journal/verify keeps project data', { timeout: 120_000 }, async (t) => {
  const { targetRoot, requests, origin } = await fixture(t);
  const before = await snapshotFixtureData(targetRoot);
  const status = await (await fetch(`${origin}/api/upgrade/status`)).json();
  assert.equal(status.manifestStatus, 'unknown');
  assert.equal(requests.length, 0, 'status must stay offline');

  const checkResponse = await request(origin, 'check', {});
  assert.equal(checkResponse.status, 200);
  const plan = await checkResponse.json();
  assert.equal(plan.releaseTag, 'v1.0.0');
  assert.equal(plan.sourceVersion, '1.0.0');
  assert.equal(plan.manifestStatus, 'legacy');
  assert.equal(plan.applicable, true);
  assert.ok(plan.counts.add + plan.counts.update + plan.counts.remove > 0);
  assert.deepEqual(requests.map(({ url }) => url), [GITHUB_RELEASE_API_URL, assetUrl]);
  assert.ok(requests.every(({ headers }) => !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')));
  assert.deepEqual(await snapshotFixtureData(targetRoot), before);
  await assert.rejects(fs.access(path.join(targetRoot, '.monstrare')), { code: 'ENOENT' });

  const invalid = await request(origin, 'apply', {
    expectedInstalledVersion: plan.installedVersion,
    expectedSourceVersion: plan.sourceVersion,
    planToken: plan.planToken,
    confirm: true,
  }, { origin: 'https://evil.example' });
  assert.equal(invalid.status, 403);
  assert.deepEqual(await snapshotFixtureData(targetRoot), before);
  await assert.rejects(fs.access(path.join(targetRoot, '.monstrare')), { code: 'ENOENT' });

  const applyResponse = await request(origin, 'apply', {
    expectedInstalledVersion: plan.installedVersion,
    expectedSourceVersion: plan.sourceVersion,
    planToken: plan.planToken,
    confirm: true,
  });
  const applied = await applyResponse.json();
  assert.equal(applyResponse.status, 200, JSON.stringify(applied));
  assert.equal(applied.toVersion, '1.0.0');
  assert.equal(applied.restartRequired, true);
  assert.equal(applied.verification.ok, true);
  assert.ok(applied.backupPath.startsWith('.monstrare/backups/'));
  const backup = path.join(targetRoot, applied.backupPath);
  assert.equal(JSON.parse(await fs.readFile(path.join(backup, 'journal.json'))).state, 'completed');
  assert.equal((await readInstallManifest(path.join(targetRoot, '.monstrare/manifest.json'))).installedVersion, '1.0.0');
  const after = await snapshotFixtureData(targetRoot);
  for (const [relativePath, content] of Object.entries(before)) {
    assert.equal(after[relativePath], content, relativePath);
  }

  const current = await (await request(origin, 'check', {})).json();
  assert.equal(current.message, '目前已是最新版本。');
  assert.equal(current.counts.add + current.counts.update + current.counts.remove, 0);

  const restarted = await startUpgradedBoard(t, targetRoot);
  const restartedStatus = await (await fetch(`${restarted}/api/upgrade/status`)).json();
  assert.equal(restartedStatus.installedVersion, '1.0.0');
  assert.equal((await fetch(`${restarted}/api/cards`)).status, 200);
  assert.equal((await fetch(`${restarted}/api/epics`)).status, 200);
});
