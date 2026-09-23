import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createUpgradeRequestHandler, createUpgradeService } from './upgrade-api.mjs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.match(/\/\* upgrade-ui:start \*\/([\s\S]*?)\/\* upgrade-ui:end \*\//)[1];
const { createUpgradeApiAdapter, createUpgradeIntegration, mapUpgradeError } =
  await import('data:text/javascript,' + encodeURIComponent(source));

const plan = {
  installedVersion: '1.0.0', sourceVersion: '1.1.0', applicable: true,
  counts: { add: 1, update: 2, remove: 1, preserve: 4, conflict: 0 },
  planToken: '0123456789abcdef', expiresAt: '2099-01-01T00:00:00.000Z',
};
const applied = {
  changed: true, changedCount: 4, backupPath: '.monstrare/backups/safe',
  verification: { ok: true, checks: [{ id: 'verify', label: '驗證', status: 'pass' }] },
};
const response = (body, ok = true) => ({ ok, json: async () => body });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('status stays local; opening checks once and confirmation sends the exact apply body', async () => {
  const calls = [];
  const adapter = createUpgradeApiAdapter(async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/status')) return response({ installedVersion: '1.0.0', writable: { ok: true }, provider: { configured: true } });
    if (path.endsWith('/check')) return response(plan);
    return response(applied);
  });
  const integration = createUpgradeIntegration(adapter);
  await adapter.status();
  assert.deepEqual(calls.map((call) => call.path), ['/api/upgrade/status']);
  await integration.open();
  assert.equal(integration.getState().phase, 'available');
  integration.requestApply();
  assert.equal(integration.getState().phase, 'confirming');
  const first = integration.confirmApply();
  const second = integration.confirmApply();
  await Promise.all([first, second]);
  assert.equal(integration.getState().phase, 'success');
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/upgrade/status', '/api/upgrade/check', '/api/upgrade/apply',
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {});
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    expectedInstalledVersion: '1.0.0', expectedSourceVersion: '1.1.0',
    planToken: '0123456789abcdef', confirm: true,
  });
});

test('cancel, expiry, and superseded checks never apply an obsolete plan', async () => {
  let resolveFirst;
  let count = 0;
  let applyCount = 0;
  const integration = createUpgradeIntegration({
    check: () => ++count === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve(plan),
    apply: () => { ++applyCount; return Promise.resolve(applied); },
  });
  const first = integration.open();
  await flush();
  const second = integration.recheck();
  await second;
  resolveFirst({ ...plan, sourceVersion: '9.9.9' });
  await first;
  assert.equal(integration.getState().plan.sourceVersion, '1.1.0');
  integration.requestApply();
  integration.cancelConfirm();
  await integration.confirmApply();
  assert.equal(applyCount, 0);

  const expiredIntegration = createUpgradeIntegration({
    check: () => Promise.resolve({ ...plan, expiresAt: '2020-01-01T00:00:00.000Z' }),
    apply: () => { ++applyCount; return Promise.resolve(applied); },
  });
  await expiredIntegration.open();
  expiredIntegration.requestApply();
  await expiredIntegration.confirmApply();
  assert.equal(expiredIntegration.getState().phase, 'available');
  assert.equal(applyCount, 0);
});

test('a check opened before status completes still honors read-only status', async () => {
  let releaseStatus;
  let checks = 0;
  const adapter = createUpgradeApiAdapter(async (resource) => {
    if (resource.endsWith('/status')) return new Promise((resolve) => { releaseStatus = resolve; });
    ++checks;
    return response(plan);
  });
  const status = adapter.status();
  const check = adapter.check();
  await flush();
  assert.equal(checks, 0);
  releaseStatus(response({ writable: { ok: false } }));
  await status;
  assert.equal((await check).writable.ok, false);
  assert.equal(checks, 1);
});

test('stale apply automatically rechecks and verification failure preserves applied result', async () => {
  let checks = 0;
  const adapter = createUpgradeApiAdapter(async (path) => {
    if (path.endsWith('/check')) { ++checks; return response(plan); }
    if (path.endsWith('/apply')) return response({ error: { code: 'UPGRADE_PLAN_STALE' } }, false);
    throw Error('unexpected path');
  });
  const integration = createUpgradeIntegration(adapter);
  await integration.open();
  integration.requestApply();
  await integration.confirmApply();
  await flush();
  assert.equal(checks, 2);
  assert.equal(integration.getState().phase, 'available');

  const failed = createUpgradeIntegration({
    check: () => Promise.resolve(plan),
    apply: () => Promise.reject({
      code: 'UPDATE_APPLIED_VERIFICATION_FAILED',
      applied: { ...applied, verification: { ok: false, checks: [] } },
    }),
  });
  await failed.open();
  failed.requestApply();
  await failed.confirmApply();
  assert.equal(failed.getState().phase, 'verification-failed');
  assert.equal(failed.getState().result.backupPath, applied.backupPath);
});

test('network, rate limit, conflict, origin, busy, and rollback errors have distinct guidance', () => {
  const codes = [
    'UPGRADE_NETWORK_ERROR', 'GITHUB_RELEASE_RATE_LIMITED', 'UPGRADE_CONFLICT',
    'UPGRADE_ORIGIN_FORBIDDEN', 'UPGRADE_BUSY', 'UPGRADE_ROLLBACK_FAILED',
  ];
  assert.equal(new Set(codes.map((code) => mapUpgradeError({ code }).title)).size, codes.length);
  assert.equal(mapUpgradeError({ code: 'UPGRADE_ROLLBACK_FAILED' }).retryable, false);
  assert.match(html, /data-confirm-add/);
  assert.match(html, /data-upgrade-verification/);
  assert.match(html, /loadUpgradeStatus\(\)/);
});

test('missing applicable approval cannot reach confirmation', async () => {
  const integration = createUpgradeIntegration({ check: () => Promise.resolve({ ...plan, applicable: undefined }) });
  await integration.open();
  assert.equal(integration.getState().phase, 'blocked');
  integration.requestApply();
  assert.equal(integration.getState().phase, 'blocked');
});

test('the client journey passes through the real local HTTP handler with a fake provider', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monstrare-task18-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let providerCalls = 0;
  let writes = 0;
  const service = createUpgradeService({
    targetRoot: root,
    provider: { async prepareLatestRelease() {
      ++providerCalls;
      return {
        sourceRoot: path.join(root, 'source'), repository: 'ttrrdfx/Monstrare',
        releaseId: 1, releaseTag: 'v1.1.0', version: '1.1.0', assetId: 2,
        assetName: 'bundle', assetDigest: 'a'.repeat(64), cleanup: async () => {},
      };
    } },
    planUpgrade: async () => ({
      targetRoot: root, installedVersion: '1.0.0', sourceVersion: '1.1.0',
      manifestStatus: 'present', applicable: true,
      summary: { add: 1, update: 0, remove: 0, preserve: 0, conflict: 0 },
      files: [{ path: 'managed/new.txt', ownership: 'managed', action: 'add', reason: 'managed-new' }],
    }),
    getPlanIntegrity: () => ({ sourceInventory: [], targetFiles: {}, installManifest: { exists: false } }),
    applyUpgrade: async () => {
      ++writes;
      return { changed: true, changedPaths: ['managed/new.txt'], backupRoot: path.join(root, '.monstrare/backups/test') };
    },
    verify: async () => ({ ok: true, checks: [{ id: 'syntax', label: '語法', status: 'pass' }] }),
    readLocalStatus: async () => ({ installedVersion: '1.0.0', manifestStatus: 'present', writable: { ok: true } }),
  });
  const handler = createUpgradeRequestHandler({
    service,
    sendJson(res, status, body) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
  });
  const server = createServer(async (req, res) => {
    if (!await handler(req, res, new URL(req.url, 'http://localhost').pathname)) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const adapter = createUpgradeApiAdapter((resource, options = {}) => fetch(origin + resource, {
    ...options, headers: { ...options.headers, Origin: origin },
  }));
  const integration = createUpgradeIntegration(adapter);
  await adapter.status();
  assert.equal(providerCalls, 0);
  await integration.open();
  assert.equal(integration.getState().phase, 'available');
  integration.requestApply();
  await integration.confirmApply();
  assert.equal(integration.getState().phase, 'success');
  assert.equal(integration.getState().result.backupPath, '.monstrare/backups/test');
  assert.equal(providerCalls, 1);
  assert.equal(writes, 1);
  await service.cleanup();
});
