import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readInstallManifest } from '../../scripts/lib/manifest.mjs';
import { planProjectUpgrade } from '../../scripts/lib/plan.mjs';
import { applyProjectUpgrade } from '../../scripts/lib/transaction.mjs';
import { runCli } from '../../scripts/monstrare.mjs';
import {
  copyFixtureTree,
  materializeLegacyStockFixture,
  snapshotFixtureData,
} from './fixtures.mjs';

const sourceRoot = path.resolve(import.meta.dirname, '../..');

async function temporaryProject(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function startBoard(t, targetRoot) {
  const child = execFile(
    process.execPath,
    [path.join(targetRoot, 'tools/kanban/server.mjs')],
    { env: { ...process.env, KANBAN_PORT: '0' } },
  );
  t.after(() => child.kill('SIGTERM'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('upgraded kanban did not start')), 8_000);
    child.once('error', reject);
    child.stderr.on('data', (chunk) => reject(new Error(chunk.toString())));
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/(http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
}

test('stock legacy fixture upgrades, verifies, preserves project data, and serves API writes', { timeout: 120_000 }, async (t) => {
  const targetRoot = await temporaryProject(t, 'monstrare-e2e-legacy-');
  await materializeLegacyStockFixture({ sourceRoot, targetRoot });
  await copyFixtureTree('project-data', targetRoot);
  const projectDataBefore = await snapshotFixtureData(targetRoot);

  const beforeDryRun = await snapshotFixtureData(targetRoot);
  const firstPlan = await planProjectUpgrade({ sourceRoot, targetRoot });
  const secondPlan = await planProjectUpgrade({ sourceRoot, targetRoot });
  assert.deepEqual(secondPlan, firstPlan);
  assert.deepEqual(await snapshotFixtureData(targetRoot), beforeDryRun);
  assert.equal(firstPlan.manifestStatus, 'legacy');
  assert.equal(firstPlan.applicable, true);

  const upgrade = await applyProjectUpgrade({ sourceRoot, targetRoot });
  assert.equal(upgrade.changed, true);
  const projectDataAfter = await snapshotFixtureData(targetRoot);
  for (const [relativePath, contents] of Object.entries(projectDataBefore)) {
    assert.equal(projectDataAfter[relativePath], contents, relativePath);
  }
  assert.equal((await readInstallManifest(path.join(targetRoot, '.monstrare/manifest.json'))).installedVersion, '1.0.0');
  assert.equal(JSON.parse(await fs.readFile(path.join(upgrade.backupRoot, 'journal.json'))).state, 'completed');

  let stdout = '';
  let stderr = '';
  const verifyExit = await runCli(['verify', targetRoot], {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  assert.equal(verifyExit, 0, stderr || stdout);
  assert.match(stdout, /Verification passed/);
  assert.match(stdout, /PASSED governance self-check/);
  assert.match(stdout, /PASSED kanban tests/);

  const url = await startBoard(t, targetRoot);
  const [cardsResponse, epicsResponse] = await Promise.all([
    fetch(`${url}/api/cards`),
    fetch(`${url}/api/epics`),
  ]);
  assert.equal(cardsResponse.status, 200);
  assert.equal((await cardsResponse.json())[0].id, 'TASK-901');
  assert.equal((await epicsResponse.json()).epics[0].name, 'Fixture Epic');

  const createResponse = await fetch(`${url}/api/cards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'E2E API smoke' }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.id, 'TASK-902');
  assert.equal((await fetch(`${url}/api/cards/${created.id}`, { method: 'DELETE' })).status, 200);
});

test('customized legacy fixture is read-only in dry-run and apply fails before backup', { timeout: 30_000 }, async (t) => {
  const targetRoot = await temporaryProject(t, 'monstrare-e2e-conflict-');
  await materializeLegacyStockFixture({ sourceRoot, targetRoot });
  await copyFixtureTree('project-data', targetRoot);
  const marker = await fs.readFile(
    path.join(import.meta.dirname, 'fixtures/customized/server-append.txt'),
  );
  const serverPath = path.join(targetRoot, 'tools/kanban/server.mjs');
  await fs.appendFile(serverPath, marker);
  const before = await snapshotFixtureData(targetRoot);
  const serverBefore = await fs.readFile(serverPath);

  const plan = await planProjectUpgrade({ sourceRoot, targetRoot });
  assert.equal(plan.applicable, false);
  assert.deepEqual(plan.localModifications.paths, ['tools/kanban/server.mjs']);
  assert.deepEqual(await snapshotFixtureData(targetRoot), before);
  await assert.rejects(
    () => applyProjectUpgrade({ sourceRoot, targetRoot }),
    (error) => error.code === 'UPGRADE_CONFLICT',
  );
  assert.deepEqual(await fs.readFile(serverPath), serverBefore);
  assert.equal(await exists(path.join(targetRoot, '.monstrare')), false);
});
