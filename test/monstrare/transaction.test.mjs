import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installProject } from '../../scripts/lib/install.mjs';
import {
  createInstallManifest,
  readInstallManifest,
  sha256,
  sha256File,
  writeInstallManifestAtomic,
} from '../../scripts/lib/manifest.mjs';
import { planProjectUpgrade } from '../../scripts/lib/plan.mjs';
import {
  applyProjectUpgrade,
  orderMutationEntries,
  transitionJournal,
  UpgradeError,
} from '../../scripts/lib/transaction.mjs';

const repositorySourceRoot = path.resolve(import.meta.dirname, '../..');

async function temporaryDirectory(t, prefix) {
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

async function writeFile(root, relativePath, contents) {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents);
}

async function writeSourceManifest(root, version) {
  await writeFile(root, 'monstrare-package.json', `${JSON.stringify({
    schemaVersion: 1,
    version,
    minimumNode: '20.0.0',
    managed: ['managed/**'],
    seedOnly: ['seed/**'],
    projectData: ['data/**'],
    sourceOnly: ['monstrare-package.json'],
  }, null, 2)}\n`);
}

async function createUpgradeFixture(t) {
  const sourceRoot = await temporaryDirectory(t, 'monstrare-transaction-source-');
  const targetRoot = await temporaryDirectory(t, 'monstrare-transaction-target-');
  await writeSourceManifest(sourceRoot, '1.0.0');
  await writeFile(sourceRoot, 'managed/keep.txt', 'keep\n');
  await writeFile(sourceRoot, 'managed/update.txt', 'old update\n');
  await writeFile(sourceRoot, 'managed/remove.txt', 'remove me\n');
  await writeFile(sourceRoot, 'seed/settings.md', 'upstream seed\n');
  await writeFile(sourceRoot, 'data/template.json', '{"source":true}\n');
  await installProject({
    sourceRoot,
    targetRoot,
    installedAt: '2026-09-15T00:00:00.000Z',
  });

  await writeFile(targetRoot, 'seed/settings.md', 'project seed\n');
  await writeFile(targetRoot, 'tools/kanban/cards/TASK-900.json', '{"project":true}\n');
  await writeFile(targetRoot, 'tools/kanban/epics.json', '{"epics":[{"name":"Project"}]}\n');

  const originalManifest = await fs.readFile(path.join(targetRoot, '.monstrare/manifest.json'));
  const projectData = {
    card: await sha256File(path.join(targetRoot, 'tools/kanban/cards/TASK-900.json')),
    epics: await sha256File(path.join(targetRoot, 'tools/kanban/epics.json')),
  };

  await writeSourceManifest(sourceRoot, '2.0.0');
  await writeFile(sourceRoot, 'managed/update.txt', 'new update\n');
  await writeFile(sourceRoot, 'managed/add.txt', 'new file\n');
  await fs.unlink(path.join(sourceRoot, 'managed/remove.txt'));

  return { sourceRoot, targetRoot, originalManifest, projectData };
}

async function assertOriginalVersion(fixture) {
  const { targetRoot, originalManifest } = fixture;
  assert.equal(await fs.readFile(path.join(targetRoot, 'managed/update.txt'), 'utf8'), 'old update\n');
  assert.equal(await fs.readFile(path.join(targetRoot, 'managed/remove.txt'), 'utf8'), 'remove me\n');
  assert.equal(await exists(path.join(targetRoot, 'managed/add.txt')), false);
  assert.deepEqual(await fs.readFile(path.join(targetRoot, '.monstrare/manifest.json')), originalManifest);
  assert.equal(await exists(path.join(targetRoot, '.monstrare/upgrade.lock')), false);
}

test('journal transitions and mutation ordering are deterministic', () => {
  const journal = { state: 'created', touched: [] };
  const backedUp = transitionJournal(journal, 'backup-complete');
  assert.equal(backedUp.state, 'backup-complete');
  assert.throws(
    () => transitionJournal(backedUp, 'completed'),
    (error) => error instanceof UpgradeError && error.code === 'JOURNAL_STATE_INVALID',
  );
  assert.deepEqual(orderMutationEntries([
    { path: 'z.txt', action: 'remove' },
    { path: 'same.txt', action: 'preserve' },
    { path: 'a.txt', action: 'update' },
    { path: 'm.txt', action: 'add' },
  ]).map(({ path: file }) => file), ['a.txt', 'm.txt', 'z.txt']);
});

test('upgrade atomically applies add, update, and remove while preserving project-owned data', async (t) => {
  const fixture = await createUpgradeFixture(t);
  const result = await applyProjectUpgrade({
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    installedAt: '2026-09-17T00:00:00.000Z',
    now: () => new Date('2026-09-17T00:00:00.000Z'),
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.changedPaths, [
    'managed/add.txt',
    'managed/remove.txt',
    'managed/update.txt',
  ]);
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'managed/add.txt'), 'utf8'), 'new file\n');
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'managed/update.txt'), 'utf8'), 'new update\n');
  assert.equal(await exists(path.join(fixture.targetRoot, 'managed/remove.txt')), false);
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'seed/settings.md'), 'utf8'), 'project seed\n');
  assert.equal(await sha256File(path.join(fixture.targetRoot, 'tools/kanban/cards/TASK-900.json')), fixture.projectData.card);
  assert.equal(await sha256File(path.join(fixture.targetRoot, 'tools/kanban/epics.json')), fixture.projectData.epics);

  const manifest = await readInstallManifest(path.join(fixture.targetRoot, '.monstrare/manifest.json'));
  assert.equal(manifest.installedVersion, '2.0.0');
  assert.equal(manifest.files['managed/remove.txt'], undefined);
  assert.equal(manifest.files['seed/settings.md'].sha256, sha256('project seed\n'));
  assert.deepEqual(await fs.readFile(path.join(result.backupRoot, 'manifest.json')), fixture.originalManifest);
  assert.equal(await fs.readFile(path.join(result.backupRoot, 'files/managed/update.txt'), 'utf8'), 'old update\n');
  assert.equal(await fs.readFile(path.join(result.backupRoot, 'files/managed/remove.txt'), 'utf8'), 'remove me\n');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.backupRoot, 'journal.json'))).state, 'completed');
  assert.equal((await fs.stat(result.backupRoot)).mode & 0o777, 0o700);
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/upgrade.lock')), false);

  const second = await applyProjectUpgrade({ sourceRoot: fixture.sourceRoot, targetRoot: fixture.targetRoot });
  assert.equal(second.changed, false);
  assert.equal(second.backupRoot, null);
});

test('conflicts stop before lock, backup, or manifest writes', async (t) => {
  const fixture = await createUpgradeFixture(t);
  await fs.appendFile(path.join(fixture.targetRoot, 'managed/update.txt'), 'local customization\n');
  const beforeManifest = await fs.readFile(path.join(fixture.targetRoot, '.monstrare/manifest.json'));

  await assert.rejects(
    () => applyProjectUpgrade({ sourceRoot: fixture.sourceRoot, targetRoot: fixture.targetRoot }),
    (error) => error.code === 'UPGRADE_CONFLICT' && error.conflicts.includes('managed/update.txt'),
  );
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/upgrade.lock')), false);
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/backups')), false);
  assert.deepEqual(await fs.readFile(path.join(fixture.targetRoot, '.monstrare/manifest.json')), beforeManifest);
  assert.match(await fs.readFile(path.join(fixture.targetRoot, 'managed/update.txt'), 'utf8'), /local customization/);
});

test('an existing lock is preserved and prevents all upgrade writes', async (t) => {
  const fixture = await createUpgradeFixture(t);
  const lockPath = path.join(fixture.targetRoot, '.monstrare/upgrade.lock');
  const existingLock = `${JSON.stringify({
    schemaVersion: 1,
    token: 'other-process',
    pid: process.pid,
    acquiredAt: '2026-09-17T00:00:00.000Z',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
  })}\n`;
  await fs.writeFile(lockPath, existingLock);

  await assert.rejects(
    () => applyProjectUpgrade({ sourceRoot: fixture.sourceRoot, targetRoot: fixture.targetRoot }),
    (error) => error.code === 'UPGRADE_LOCKED',
  );
  assert.equal(await fs.readFile(lockPath, 'utf8'), existingLock);
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/backups')), false);
  assert.deepEqual(await fs.readFile(path.join(fixture.targetRoot, '.monstrare/manifest.json')), fixture.originalManifest);
});

test('target and source changes after planning are rejected without overwriting new content', async (t) => {
  const targetFixture = await createUpgradeFixture(t);
  const targetPlan = await planProjectUpgrade(targetFixture);
  await fs.writeFile(path.join(targetFixture.targetRoot, 'managed/update.txt'), 'changed after plan\n');
  await assert.rejects(
    () => applyProjectUpgrade({ ...targetFixture, plan: targetPlan }),
    (error) => error.code === 'UPGRADE_PLAN_STALE',
  );
  assert.equal(await fs.readFile(path.join(targetFixture.targetRoot, 'managed/update.txt'), 'utf8'), 'changed after plan\n');
  assert.equal(await exists(path.join(targetFixture.targetRoot, '.monstrare/upgrade.lock')), false);

  const sourceFixture = await createUpgradeFixture(t);
  const sourcePlan = await planProjectUpgrade(sourceFixture);
  await fs.writeFile(path.join(sourceFixture.sourceRoot, 'managed/update.txt'), 'source changed after plan\n');
  await assert.rejects(
    () => applyProjectUpgrade({ ...sourceFixture, plan: sourcePlan }),
    (error) => error.code === 'UPGRADE_PLAN_STALE',
  );
  await assertOriginalVersion(sourceFixture);
});

for (const failureStage of [
  'backup-complete',
  'staging-complete',
  'after-apply-file',
  'before-manifest',
  'after-manifest',
]) {
  test(`failure at ${failureStage} restores files and the old manifest`, async (t) => {
    const fixture = await createUpgradeFixture(t);
    let injected = false;
    let error;
    try {
      await applyProjectUpgrade({
        sourceRoot: fixture.sourceRoot,
        targetRoot: fixture.targetRoot,
        now: () => new Date('2026-09-17T01:02:03.000Z'),
        faultInjector: async (stage) => {
          if (!injected && stage === failureStage) {
            injected = true;
            throw new Error(`simulated ${stage} failure`);
          }
        },
      });
    } catch (caught) {
      error = caught;
    }
    assert.equal(injected, true);
    assert.match(error.message, new RegExp(`simulated ${failureStage} failure`));
    assert.ok(error.backupRoot);
    await assertOriginalVersion(fixture);
    assert.equal(JSON.parse(await fs.readFile(path.join(error.backupRoot, 'journal.json'))).state, 'rolled-back');
  });
}

test('backup symlink escape is rejected and never writes outside the target', async (t) => {
  const fixture = await createUpgradeFixture(t);
  const outside = await temporaryDirectory(t, 'monstrare-transaction-outside-');
  await fs.symlink(outside, path.join(fixture.targetRoot, '.monstrare/backups'));

  await assert.rejects(
    () => applyProjectUpgrade({ sourceRoot: fixture.sourceRoot, targetRoot: fixture.targetRoot }),
    (error) => error.code === 'UPGRADE_PATH_UNSAFE',
  );
  assert.deepEqual(await fs.readdir(outside), []);
  await assertOriginalVersion(fixture);
});

test('a managed parent symlink is rejected before any managed file changes', async (t) => {
  const fixture = await createUpgradeFixture(t);
  const realManaged = path.join(fixture.targetRoot, 'real-managed');
  await fs.rename(path.join(fixture.targetRoot, 'managed'), realManaged);
  await fs.symlink(realManaged, path.join(fixture.targetRoot, 'managed'));

  await assert.rejects(
    () => applyProjectUpgrade({ sourceRoot: fixture.sourceRoot, targetRoot: fixture.targetRoot }),
    (error) => error.code === 'UPGRADE_SYMLINK_UNSAFE',
  );
  assert.equal(await fs.readFile(path.join(realManaged, 'update.txt'), 'utf8'), 'old update\n');
  assert.equal(await exists(path.join(realManaged, 'add.txt')), false);
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/upgrade.lock')), false);
});

test('an upgraded real board starts and reads the original cards and epics', { timeout: 20_000 }, async (t) => {
  const targetRoot = await temporaryDirectory(t, 'monstrare-transaction-board-');
  await installProject({ sourceRoot: repositorySourceRoot, targetRoot });
  await writeFile(targetRoot, 'tools/kanban/cards/TASK-901.json', JSON.stringify({
    id: 'TASK-901', title: 'Preserved', content: '', stage: 'backlog', risk: 'low', owner: '', agent: '',
    approvalRequired: false, createdAt: '2026-09-17', epic: '', userStory: '', track: 'n/a', dependsOn: [], order: 1,
    readiness: {}, gates: {}, links: {}, refs: [], evidence: {}, comments: [],
  }));
  const projectEpics = { epics: [{ name: 'Project Epic', goal: 'Preserve me', order: 1 }] };
  await writeFile(targetRoot, 'tools/kanban/epics.json', `${JSON.stringify(projectEpics)}\n`);

  const manifestPath = path.join(targetRoot, '.monstrare/manifest.json');
  const oldManifest = await readInstallManifest(manifestPath);
  await fs.writeFile(path.join(targetRoot, 'tools/kanban/server.mjs'), '// simulated prior release\n');
  oldManifest.files['tools/kanban/server.mjs'].sha256 = sha256('// simulated prior release\n');
  const previousManifest = createInstallManifest({
    installedVersion: '0.9.0',
    installedAt: '2026-09-15T00:00:00.000Z',
    files: oldManifest.files,
  });
  await writeInstallManifestAtomic(manifestPath, previousManifest);

  const result = await applyProjectUpgrade({ sourceRoot: repositorySourceRoot, targetRoot });
  assert.equal(result.changed, true);
  assert.ok(result.changedPaths.includes('tools/kanban/server.mjs'));

  const child = execFile(
    process.execPath,
    [path.join(targetRoot, 'tools/kanban/server.mjs')],
    { env: { ...process.env, KANBAN_PORT: '0' } },
  );
  t.after(() => child.kill('SIGTERM'));
  const url = await new Promise((resolve, reject) => {
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
  const [pageResponse, cardsResponse, epicsResponse] = await Promise.all([
    fetch(url),
    fetch(`${url}/api/cards`),
    fetch(`${url}/api/epics`),
  ]);
  assert.equal(pageResponse.status, 200);
  assert.equal((await cardsResponse.json())[0].id, 'TASK-901');
  assert.deepEqual(await epicsResponse.json(), projectEpics);
});
