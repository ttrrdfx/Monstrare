import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createReleaseSessionStore } from '../../scripts/lib/github-release.mjs';
import {
  createUpgradePlanDigest,
  createUpgradeRequestHandler,
  createUpgradeService,
  readUpgradeJsonBody,
  resolveKanbanProjectRoot,
  UpgradeApiError,
  validateUpgradeBody,
  validateUpgradePostHeaders,
} from './upgrade-api.mjs';

const SERVER_FILE = new URL('./server.mjs', import.meta.url);
const DIGEST = 'a'.repeat(64);

function makePlan(overrides = {}) {
  const files = overrides.files ?? [
    { path: 'managed/a.txt', ownership: 'managed', action: 'update', reason: 'managed-unmodified' },
    { path: 'data/keep.json', ownership: 'project-data', action: 'preserve', reason: 'project-owned' },
  ];
  const summary = Object.fromEntries(['add', 'update', 'remove', 'preserve', 'conflict'].map((action) => [
    action,
    files.filter((entry) => entry.action === action).length,
  ]));
  return {
    targetRoot: '/project',
    installedVersion: '1.0.0',
    sourceVersion: '2.0.0',
    manifestStatus: 'present',
    applicable: summary.conflict === 0,
    summary,
    files,
    ...overrides,
  };
}

async function temporaryDirectory(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function createServiceFixture(t, overrides = {}) {
  const targetRoot = await temporaryDirectory(t, 'monstrare-upgrade-api-target-');
  const sourceRoot = await temporaryDirectory(t, 'monstrare-upgrade-api-source-');
  let prepareCalls = 0;
  let cleanupCalls = 0;
  const prepared = {
    sourceRoot,
    repository: 'ttrrdfx/Monstrare',
    releaseId: 100,
    releaseTag: 'v2.0.0',
    version: '2.0.0',
    assetId: 200,
    assetName: 'monstrare-v2.0.0.bundle.json',
    assetDigest: DIGEST,
    async cleanup() { cleanupCalls += 1; },
  };
  const provider = overrides.provider ?? {
    async prepareLatestRelease() {
      prepareCalls += 1;
      return prepared;
    },
  };
  const sessionStore = createReleaseSessionStore({
    clock: () => Date.parse('2026-09-21T00:00:00.000Z'),
    randomToken: () => '00000000-0000-4000-8000-000000000016',
  });
  let planCalls = 0;
  const basePlan = makePlan({ targetRoot });
  const planUpgrade = overrides.planUpgrade ?? (async () => {
    planCalls += 1;
    return basePlan;
  });
  const service = createUpgradeService({
    targetRoot,
    provider,
    sessionStore,
    planUpgrade,
    getPlanIntegrity: overrides.getPlanIntegrity ?? (() => ({
      sourceInventory: [
        { path: 'managed/a.txt', ownership: 'managed', sha256: '1'.repeat(64) },
      ],
      targetFiles: {
        'managed/a.txt': { exists: true, type: 'file', sha256: '2'.repeat(64) },
      },
      installManifest: { exists: true, sha256: '3'.repeat(64) },
    })),
    applyUpgrade: overrides.applyUpgrade ?? (async () => ({
      changed: true,
      backupRoot: path.join(targetRoot, '.monstrare/backups/backup-1'),
      changedPaths: ['managed/a.txt'],
    })),
    verify: overrides.verify ?? (async () => ({
      ok: true,
      checks: [{ id: 'syntax', label: 'syntax', status: 'passed', detail: '/secret/path' }],
    })),
    readLocalStatus: overrides.readLocalStatus ?? (async () => ({
      installedVersion: '1.0.0',
      manifestStatus: 'present',
      writable: { ok: true },
    })),
    now: () => new Date('2026-09-21T01:02:03.000Z'),
  });
  return {
    service,
    targetRoot,
    sourceRoot,
    prepared,
    getPrepareCalls: () => prepareCalls,
    getCleanupCalls: () => cleanupCalls,
    getPlanCalls: () => planCalls,
  };
}

function applyInput(planToken) {
  return {
    expectedInstalledVersion: '1.0.0',
    expectedSourceVersion: '2.0.0',
    planToken,
    confirm: true,
  };
}

test('upgrade request schemas reject extra fields, missing confirmation, and invalid versions', () => {
  assert.deepEqual(validateUpgradeBody('check', {}), {});
  assert.throws(
    () => validateUpgradeBody('check', { repository: 'attacker/repo' }),
    (error) => error.code === 'UPGRADE_REQUEST_INVALID',
  );
  assert.throws(
    () => validateUpgradeBody('apply', {
      ...applyInput('00000000-0000-4000-8000-000000000016'),
      confirm: false,
    }),
    (error) => error.code === 'UPGRADE_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => validateUpgradeBody('apply', {
      ...applyInput('00000000-0000-4000-8000-000000000016'),
      expectedSourceVersion: 'v2',
    }),
    (error) => error.code === 'UPGRADE_REQUEST_INVALID',
  );
  assert.throws(
    () => validateUpgradeBody('apply', {
      ...applyInput('00000000-0000-4000-8000-000000000016'),
      targetRoot: '/tmp/other',
    }),
    (error) => error.code === 'UPGRADE_REQUEST_INVALID',
  );
});

test('upgrade POST boundary requires exact local Host/Origin and JSON content type', () => {
  const valid = {
    host: '127.0.0.1:4420',
    origin: 'http://127.0.0.1:4420',
    'content-type': 'application/json; charset=utf-8',
    'sec-fetch-site': 'same-origin',
  };
  assert.doesNotThrow(() => validateUpgradePostHeaders(valid, 4420));
  for (const headers of [
    { ...valid, host: 'evil.example' },
    { ...valid, origin: 'http://localhost:4420' },
    { ...valid, 'sec-fetch-site': 'cross-site' },
  ]) {
    assert.throws(
      () => validateUpgradePostHeaders(headers, 4420),
      (error) => error.code === 'UPGRADE_ORIGIN_FORBIDDEN',
    );
  }
  assert.throws(
    () => validateUpgradePostHeaders({ ...valid, 'content-type': 'text/plain' }, 4420),
    (error) => error.code === 'UPGRADE_CONTENT_TYPE_REQUIRED',
  );
});

test('upgrade body reader rejects invalid JSON and byte-limit overflow', async () => {
  const request = (body, headers = {}) => Object.assign(Readable.from([body]), { headers });
  assert.deepEqual(await readUpgradeJsonBody(request('{}')), {});
  await assert.rejects(
    () => readUpgradeJsonBody(request('{')),
    (error) => error.code === 'UPGRADE_REQUEST_INVALID',
  );
  await assert.rejects(
    () => readUpgradeJsonBody(request('12345', { 'content-length': '5' }), { limit: 4 }),
    (error) => error.code === 'UPGRADE_BODY_TOO_LARGE',
  );
});

test('plan digest is stable across entry order and changes with the plan', () => {
  const release = {
    repository: 'ttrrdfx/Monstrare',
    releaseId: 1,
    releaseTag: 'v2.0.0',
    assetDigest: DIGEST,
  };
  const first = makePlan();
  const reordered = makePlan({ files: [...first.files].reverse(), summary: first.summary });
  assert.equal(createUpgradePlanDigest(first, release), createUpgradePlanDigest(reordered, release));
  assert.notEqual(
    createUpgradePlanDigest(first, release),
    createUpgradePlanDigest(makePlan({ files: [{ ...first.files[0], reason: 'changed' }] }), release),
  );
  assert.notEqual(
    createUpgradePlanDigest(first, release, {
      sourceInventory: [{ path: 'managed/a.txt', ownership: 'managed', sha256: '1'.repeat(64) }],
      targetFiles: {},
      installManifest: { exists: false },
    }),
    createUpgradePlanDigest(first, release, {
      sourceInventory: [{ path: 'managed/a.txt', ownership: 'managed', sha256: '2'.repeat(64) }],
      targetFiles: {},
      installManifest: { exists: false },
    }),
  );
});

test('status is offline and reports only local/provider state', async (t) => {
  const fixture = await createServiceFixture(t);
  const status = await fixture.service.status();
  assert.equal(fixture.getPrepareCalls(), 0);
  assert.deepEqual(status, {
    installedVersion: '1.0.0',
    manifestStatus: 'present',
    provider: { repository: 'ttrrdfx/Monstrare', configured: true },
    lastCheck: null,
    writable: { ok: true },
  });
});

test('check returns a bounded DTO without changing target content, mtime, or metadata directory', async (t) => {
  const fixture = await createServiceFixture(t);
  const marker = path.join(fixture.targetRoot, 'project.txt');
  await fs.writeFile(marker, 'unchanged\n');
  const before = await fs.stat(marker);
  const result = await fixture.service.check();
  const after = await fs.stat(marker);

  assert.equal(await fs.readFile(marker, 'utf8'), 'unchanged\n');
  assert.equal(after.mtimeMs, before.mtimeMs);
  await assert.rejects(() => fs.access(path.join(fixture.targetRoot, '.monstrare')), { code: 'ENOENT' });
  assert.equal(result.repository, 'ttrrdfx/Monstrare');
  assert.equal(result.releaseTag, 'v2.0.0');
  assert.equal(result.planToken, '00000000-0000-4000-8000-000000000016');
  assert.deepEqual(result.counts, { add: 0, update: 1, remove: 0, preserve: 1, conflict: 0 });
  assert.deepEqual(result.entries, [
    { path: 'managed/a.txt', action: 'update', reason: 'managed-unmodified' },
    { path: 'data/keep.json', action: 'preserve', reason: 'project-owned' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(fixture.targetRoot));
});

test('apply replans, returns relative backup and restricted verification summary, then disposes session', async (t) => {
  const fixture = await createServiceFixture(t);
  const checked = await fixture.service.check();
  const result = await fixture.service.apply(applyInput(checked.planToken));
  assert.equal(fixture.getPlanCalls(), 2);
  assert.deepEqual(result, {
    changed: true,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    changedCount: 1,
    backupPath: '.monstrare/backups/backup-1',
    verification: { ok: true, checks: [{ id: 'syntax', label: 'syntax', status: 'passed' }] },
    restartRequired: true,
  });
  assert.equal(fixture.getCleanupCalls(), 1);
  await assert.rejects(
    () => fixture.service.apply(applyInput(checked.planToken)),
    (error) => error.code === 'UPGRADE_PLAN_EXPIRED',
  );
});

test('changed plan is rejected before transaction and the stale session is disposed', async (t) => {
  let calls = 0;
  let applyCalls = 0;
  const fixture = await createServiceFixture(t, {
    async planUpgrade({ targetRoot }) {
      calls += 1;
      return calls === 1
        ? makePlan({ targetRoot })
        : makePlan({
          targetRoot,
          files: [{ path: 'managed/a.txt', ownership: 'managed', action: 'conflict', reason: 'managed-modified' }],
        });
    },
    async applyUpgrade() {
      applyCalls += 1;
      return {};
    },
  });
  const checked = await fixture.service.check();
  await assert.rejects(
    () => fixture.service.apply(applyInput(checked.planToken)),
    (error) => error.code === 'UPGRADE_PLAN_STALE' && error.retryable === true,
  );
  assert.equal(applyCalls, 0);
  assert.equal(fixture.getCleanupCalls(), 1);
});

test('changed source hash is stale even when path/action/reason are unchanged', async (t) => {
  let integrityCalls = 0;
  let applyCalls = 0;
  const fixture = await createServiceFixture(t, {
    getPlanIntegrity() {
      integrityCalls += 1;
      return {
        sourceInventory: [{
          path: 'managed/a.txt',
          ownership: 'managed',
          sha256: (integrityCalls === 1 ? '1' : '2').repeat(64),
        }],
        targetFiles: {},
        installManifest: { exists: false },
      };
    },
    async applyUpgrade() {
      applyCalls += 1;
      return {};
    },
  });
  const checked = await fixture.service.check();
  await assert.rejects(
    () => fixture.service.apply(applyInput(checked.planToken)),
    (error) => error.code === 'UPGRADE_PLAN_STALE',
  );
  assert.equal(applyCalls, 0);
});

test('a replan error after check is reported as stale without entering transaction', async (t) => {
  let planCalls = 0;
  let applyCalls = 0;
  const fixture = await createServiceFixture(t, {
    async planUpgrade({ targetRoot }) {
      planCalls += 1;
      if (planCalls > 1) throw new Error('source disappeared at /private/path');
      return makePlan({ targetRoot });
    },
    async applyUpgrade() {
      applyCalls += 1;
      return {};
    },
  });
  const checked = await fixture.service.check();
  await assert.rejects(
    () => fixture.service.apply(applyInput(checked.planToken)),
    (error) => error.code === 'UPGRADE_PLAN_STALE' && !error.message.includes('/private/path'),
  );
  assert.equal(applyCalls, 0);
});

test('process-local mutex rejects a concurrent apply before entering transaction', async (t) => {
  let releaseApply;
  let enteredApply;
  const entered = new Promise((resolve) => { enteredApply = resolve; });
  const fixture = await createServiceFixture(t, {
    applyUpgrade: async () => {
      enteredApply();
      await new Promise((resolve) => { releaseApply = resolve; });
      return { changed: true, backupRoot: null, changedPaths: [] };
    },
  });
  const checked = await fixture.service.check();
  const first = fixture.service.apply(applyInput(checked.planToken));
  await entered;
  await assert.rejects(
    () => fixture.service.apply(applyInput(checked.planToken)),
    (error) => error.code === 'UPGRADE_BUSY',
  );
  releaseApply();
  await first;
});

test('check and apply cannot overlap or replace an in-use release session', async (t) => {
  let releaseCheck;
  let enteredCheck;
  let preparedValue;
  const entered = new Promise((resolve) => { enteredCheck = resolve; });
  const fixture = await createServiceFixture(t, {
    provider: {
      async prepareLatestRelease() {
        enteredCheck();
        await new Promise((resolve) => { releaseCheck = resolve; });
        return preparedValue;
      },
    },
  });
  preparedValue = fixture.prepared;
  const checking = fixture.service.check();
  await entered;
  await assert.rejects(
    () => fixture.service.apply(applyInput('00000000-0000-4000-8000-000000000016')),
    (error) => error.code === 'UPGRADE_BUSY',
  );
  releaseCheck();
  await checking;
});

test('transaction rollback, rollback failure, and committed verification failure remain distinguishable', async (t) => {
  for (const scenario of [
    { transactionCode: 'UPGRADE_FAILED', expected: 'UPGRADE_TRANSACTION_FAILED' },
    { transactionCode: 'UPGRADE_RECOVERY_FAILED', expected: 'UPGRADE_ROLLBACK_FAILED' },
  ]) {
    const fixture = await createServiceFixture(t, {
      applyUpgrade: async () => {
        const error = new Error('private failure at /Users/example/project');
        error.code = scenario.transactionCode;
        error.backupRoot = path.join(fixture.targetRoot, '.monstrare/backups/recovery');
        throw error;
      },
    });
    const checked = await fixture.service.check();
    await assert.rejects(
      () => fixture.service.apply(applyInput(checked.planToken)),
      (error) => error.code === scenario.expected
        && error.details.backupPath === '.monstrare/backups/recovery'
        && !error.message.includes('/Users/'),
    );
  }

  const failedVerify = await createServiceFixture(t, {
    verify: async () => ({
      ok: false,
      checks: [{ id: 'tests', label: 'tests', status: 'failed', detail: '/Users/private/output' }],
    }),
  });
  const checked = await failedVerify.service.check();
  await assert.rejects(
    () => failedVerify.service.apply(applyInput(checked.planToken)),
    (error) => error.code === 'UPDATE_APPLIED_VERIFICATION_FAILED'
      && error.details.applied.restartRequired === true
      && error.details.applied.verification.checks[0].status === 'failed'
      && !JSON.stringify(error.details).includes('/Users/private'),
  );
});

test('HTTP handler validates the boundary before invoking service and emits stable envelopes', async () => {
  let calls = 0;
  const service = {
    async check() { calls += 1; return { ok: true }; },
    async status() { calls += 1; return { installedVersion: '1.0.0' }; },
  };
  const responses = [];
  const handler = createUpgradeRequestHandler({
    service,
    sendJson(_res, status, body) { responses.push({ status, body }); },
  });
  const request = Object.assign(Readable.from(['{"repository":"attacker/repo"}']), {
    method: 'POST',
    headers: {
      host: '127.0.0.1:4420',
      origin: 'http://127.0.0.1:4420',
      'content-type': 'application/json',
    },
    socket: { localPort: 4420 },
  });
  assert.equal(await handler(request, {}, '/api/upgrade/check'), true);
  assert.equal(calls, 0);
  assert.deepEqual(responses[0], {
    status: 400,
    body: {
      error: {
        code: 'UPGRADE_REQUEST_INVALID',
        message: 'check body 欄位不符合 API 契約。',
        retryable: false,
      },
    },
  });
});

async function startServer(t) {
  const kanbanRoot = await temporaryDirectory(t, 'monstrare-upgrade-server-data-');
  const projectRoot = await temporaryDirectory(t, 'monstrare-upgrade-server-project-');
  await fs.mkdir(path.join(kanbanRoot, 'cards'));
  await fs.writeFile(path.join(kanbanRoot, 'index.html'), '<!doctype html><title>test</title>');
  await fs.writeFile(path.join(kanbanRoot, 'epics.json'), '{"epics":[]}\n');
  await fs.writeFile(path.join(projectRoot, 'VERSION'), '1.2.3\n');
  const child = spawn(process.execPath, [SERVER_FILE.pathname], {
    env: {
      ...process.env,
      KANBAN_ROOT: kanbanRoot,
      KANBAN_PROJECT_ROOT: projectRoot,
      KANBAN_TEST_MODE: '1',
      KANBAN_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  const baseUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server start timeout: ${stderr}`)), 3000);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early (${code}): ${stderr}`));
    });
    child.stdout.on('data', (chunk) => {
      const match = chunk.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  });
  return { baseUrl, child, projectRoot };
}

test('server exposes offline status and rejects unsafe POST before provider access', async (t) => {
  const { baseUrl, projectRoot } = await startServer(t);
  const statusResponse = await fetch(`${baseUrl}/api/upgrade/status`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.installedVersion, '1.2.3');
  assert.equal(status.manifestStatus, 'legacy');
  assert.equal(status.provider.repository, 'ttrrdfx/Monstrare');

  const badOrigin = await fetch(`${baseUrl}/api/upgrade/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: '{}',
  });
  assert.equal(badOrigin.status, 403);
  assert.equal((await badOrigin.json()).error.code, 'UPGRADE_ORIGIN_FORBIDDEN');

  const before = await fs.readFile(path.join(projectRoot, 'VERSION'), 'utf8');
  const extraField = await fetch(`${baseUrl}/api/upgrade/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: '{"repository":"attacker/repo"}',
  });
  assert.equal(extraField.status, 400);
  assert.equal((await extraField.json()).error.code, 'UPGRADE_REQUEST_INVALID');
  assert.equal(await fs.readFile(path.join(projectRoot, 'VERSION'), 'utf8'), before);
});

test('project root is derived from module location and only the explicit test override changes it', () => {
  assert.equal(
    resolveKanbanProjectRoot({ moduleRoot: '/repo/tools/kanban', environment: {} }),
    path.resolve('/repo'),
  );
  assert.equal(
    resolveKanbanProjectRoot({
      moduleRoot: '/repo/tools/kanban',
      environment: { KANBAN_PROJECT_ROOT: '/fixture/project', KANBAN_TEST_MODE: '1' },
    }),
    path.resolve('/fixture/project'),
  );
  assert.throws(
    () => resolveKanbanProjectRoot({
      moduleRoot: '/repo/tools/kanban',
      environment: { KANBAN_PROJECT_ROOT: '/fixture/project' },
    }),
    (error) => error.code === 'UPGRADE_CONFIG_INVALID',
  );
});
