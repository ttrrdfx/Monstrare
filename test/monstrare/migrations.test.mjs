import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installProject } from '../../scripts/lib/install.mjs';
import {
  buildMigrationChain,
  MigrationError,
  prepareMigrations,
  validateMigrationRegistry,
} from '../../scripts/lib/migrations.mjs';
import {
  createInstallManifest,
  readInstallManifest,
  writeInstallManifestAtomic,
} from '../../scripts/lib/manifest.mjs';
import { applyProjectUpgrade } from '../../scripts/lib/transaction.mjs';
import { copyFixtureTree } from './fixtures.mjs';

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
    seedOnly: [],
    projectData: ['data/**'],
    sourceOnly: ['monstrare-package.json'],
  }, null, 2)}\n`);
}

function dataMigration({ apply, allowedPaths = ['data/state.json'], validate } = {}) {
  return {
    id: 'data-schema-v2',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    allowedPaths,
    async check(context) {
      const state = await context.readJson('data/state.json');
      if (state.schemaVersion === 1) return 'needed';
      if (state.schemaVersion === 2) return 'already-applied';
      return 'incompatible';
    },
    apply: apply ?? (async (context) => {
      const state = await context.readJson('data/state.json');
      await context.writeJson('data/state.json', { ...state, schemaVersion: 2 });
    }),
    validate,
  };
}

async function createMigrationFixture(t) {
  const sourceRoot = await temporaryDirectory(t, 'monstrare-migration-source-');
  const targetRoot = await temporaryDirectory(t, 'monstrare-migration-target-');
  await writeSourceManifest(sourceRoot, '1.0.0');
  await writeFile(sourceRoot, 'managed/tool.txt', 'old tool\n');
  await installProject({ sourceRoot, targetRoot, installedAt: '2026-09-15T00:00:00.000Z' });
  await copyFixtureTree('migration', targetRoot);
  const originalManifest = await fs.readFile(path.join(targetRoot, '.monstrare/manifest.json'));
  await writeSourceManifest(sourceRoot, '2.0.0');
  await writeFile(sourceRoot, 'managed/tool.txt', 'new tool\n');
  return { sourceRoot, targetRoot, originalManifest };
}

test('registry validation sorts a continuous chain and rejects gaps, duplicates, cycles, and hostile ids', () => {
  const noop = async () => {};
  const needed = async () => 'needed';
  const later = {
    id: 'step-2', fromVersion: '2.0.0', toVersion: '3.0.0',
    allowedPaths: ['data/two.json'], check: needed, apply: noop,
  };
  const earlier = {
    id: 'step-1', fromVersion: '1.0.0', toVersion: '2.0.0',
    allowedPaths: ['data/one.json'], check: needed, apply: noop,
  };
  assert.deepEqual(
    buildMigrationChain({ fromVersion: '1.0.0', toVersion: '3.0.0', registry: [later, earlier] })
      .map(({ id }) => id),
    ['step-1', 'step-2'],
  );
  assert.deepEqual(buildMigrationChain({ fromVersion: '1.0.0', toVersion: '2.0.0', registry: [] }), []);
  assert.throws(
    () => buildMigrationChain({ fromVersion: '1.0.0', toVersion: '3.0.0', registry: [earlier] }),
    (error) => error instanceof MigrationError && error.code === 'MIGRATION_CHAIN_GAP',
  );
  assert.throws(
    () => validateMigrationRegistry([earlier, { ...later, id: earlier.id }]),
    (error) => error.code === 'MIGRATION_DUPLICATE_ID',
  );
  assert.throws(
    () => validateMigrationRegistry([{ ...earlier, id: 'backward', fromVersion: '2.0.0', toVersion: '1.0.0' }]),
    (error) => error.code === 'MIGRATION_CYCLE',
  );
  assert.throws(
    () => validateMigrationRegistry([{ ...earlier, id: '../escape' }]),
    (error) => error.code === 'MIGRATION_REGISTRY_INVALID',
  );
});

test('check is read-only and supports needed, already-applied, and incompatible states', async (t) => {
  const targetRoot = await temporaryDirectory(t, 'monstrare-migration-check-');
  await writeFile(targetRoot, 'data/state.json', '{"schemaVersion":1}\n');
  const needed = await prepareMigrations({
    targetRoot,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    registry: [dataMigration()],
  });
  assert.equal(needed[0].status, 'needed');

  await writeFile(targetRoot, 'data/state.json', '{"schemaVersion":2}\n');
  const applied = await prepareMigrations({
    targetRoot,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    registry: [dataMigration()],
  });
  assert.equal(applied[0].status, 'already-applied');

  await writeFile(targetRoot, 'data/state.json', '{"schemaVersion":99}\n');
  await assert.rejects(
    () => prepareMigrations({
      targetRoot,
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      registry: [dataMigration()],
    }),
    (error) => error.code === 'MIGRATION_INCOMPATIBLE',
  );

  const mutatingCheck = dataMigration();
  mutatingCheck.check = async (context) => {
    await context.writeText('data/state.json', 'mutated\n');
    return 'needed';
  };
  await assert.rejects(
    () => prepareMigrations({
      targetRoot,
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      registry: [mutatingCheck],
    }),
    (error) => error.code === 'MIGRATION_READ_ONLY',
  );
});

test('migration is backed up, applied in the upgrade journal, and a repeat upgrade is a no-op', async (t) => {
  const fixture = await createMigrationFixture(t);
  const result = await applyProjectUpgrade({
    ...fixture,
    migrationRegistry: [dataMigration()],
    now: () => new Date('2026-09-18T01:02:03.000Z'),
  });

  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'managed/tool.txt'), 'utf8'), 'new tool\n');
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(fixture.targetRoot, 'data/state.json'))),
    { schemaVersion: 2, project: 'kept' },
  );
  assert.deepEqual(result.migrations, [{
    id: 'data-schema-v2', status: 'applied', touchedPaths: ['data/state.json'],
  }]);
  assert.deepEqual(result.changedPaths, ['data/state.json', 'managed/tool.txt']);
  assert.equal(
    await fs.readFile(path.join(result.backupRoot, 'migrations/data-schema-v2/files/data/state.json'), 'utf8'),
    '{"schemaVersion":1,"project":"kept"}\n',
  );
  const journal = JSON.parse(await fs.readFile(path.join(result.backupRoot, 'journal.json')));
  assert.equal(journal.state, 'completed');
  assert.equal(journal.migrations[0].status, 'applied');

  const second = await applyProjectUpgrade({ ...fixture, migrationRegistry: [dataMigration()] });
  assert.equal(second.changed, false);
  assert.equal(second.backupRoot, null);
});

test('an incomplete required migration chain fails before lock, backup, or target writes', async (t) => {
  const fixture = await createMigrationFixture(t);
  const incomplete = {
    ...dataMigration(),
    id: 'data-schema-v1-5',
    toVersion: '1.5.0',
  };
  await assert.rejects(
    () => applyProjectUpgrade({ ...fixture, migrationRegistry: [incomplete] }),
    (error) => error.code === 'MIGRATION_CHAIN_GAP',
  );
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/upgrade.lock')), false);
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/backups')), false);
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'managed/tool.txt'), 'utf8'), 'old tool\n');
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'data/state.json'), 'utf8'), '{"schemaVersion":1,"project":"kept"}\n');
  assert.deepEqual(await fs.readFile(path.join(fixture.targetRoot, '.monstrare/manifest.json')), fixture.originalManifest);
});

test('a multi-step chain checks each migration against its predecessor output', async (t) => {
  const fixture = await createMigrationFixture(t);
  await writeSourceManifest(fixture.sourceRoot, '3.0.0');
  function step(id, fromVersion, toVersion, fromSchema, toSchema) {
    return {
      id,
      fromVersion,
      toVersion,
      allowedPaths: ['data/state.json'],
      async check(context) {
        const state = await context.readJson('data/state.json');
        if (state.schemaVersion === fromSchema) return 'needed';
        if (state.schemaVersion === toSchema) return 'already-applied';
        return 'incompatible';
      },
      async apply(context) {
        const state = await context.readJson('data/state.json');
        await context.writeJson('data/state.json', { ...state, schemaVersion: toSchema });
      },
    };
  }
  const registry = [
    step('data-v1-to-v2', '1.0.0', '2.0.0', 1, 2),
    step('data-v2-to-v3', '2.0.0', '3.0.0', 2, 3),
  ];
  const prepared = await prepareMigrations({
    targetRoot: fixture.targetRoot,
    fromVersion: '1.0.0',
    toVersion: '3.0.0',
    registry,
  });
  assert.deepEqual(prepared.map(({ status }) => status), ['needed', 'pending']);

  const result = await applyProjectUpgrade({ ...fixture, migrationRegistry: registry });
  assert.deepEqual(result.migrations.map(({ id, status }) => ({ id, status })), [
    { id: 'data-v1-to-v2', status: 'applied' },
    { id: 'data-v2-to-v3', status: 'applied' },
  ]);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(fixture.targetRoot, 'data/state.json'))).schemaVersion,
    3,
  );
});

test('migration failure restores project data, managed files, and manifest', async (t) => {
  const fixture = await createMigrationFixture(t);
  await writeFile(fixture.targetRoot, 'data/untouched.json', '{"keep":true}\n');
  const migration = dataMigration({
    apply: async (context) => {
      await context.writeJson('data/state.json', { schemaVersion: 2, partial: true });
      await context.writeText('data/created.txt', 'partial\n');
      throw new Error('simulated migration failure');
    },
    allowedPaths: ['data/**'],
  });
  let error;
  try {
    await applyProjectUpgrade({ ...fixture, migrationRegistry: [migration] });
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /simulated migration failure/);
  assert.ok(error.backupRoot);
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'data/state.json'), 'utf8'), '{"schemaVersion":1,"project":"kept"}\n');
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'data/untouched.json'), 'utf8'), '{"keep":true}\n');
  assert.equal(await exists(path.join(fixture.targetRoot, 'data/created.txt')), false);
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'managed/tool.txt'), 'utf8'), 'old tool\n');
  assert.deepEqual(await fs.readFile(path.join(fixture.targetRoot, '.monstrare/manifest.json')), fixture.originalManifest);
  assert.equal(await exists(path.join(fixture.targetRoot, '.monstrare/upgrade.lock')), false);
  assert.equal(
    await fs.readFile(path.join(error.backupRoot, 'migrations/data-schema-v2/files/data/untouched.json'), 'utf8'),
    '{"keep":true}\n',
  );
  assert.equal(JSON.parse(await fs.readFile(path.join(error.backupRoot, 'journal.json'))).state, 'rolled-back');
});

test('out-of-scope and symlink migration paths fail closed', async (t) => {
  const scopeFixture = await createMigrationFixture(t);
  const escapingMigration = dataMigration({
    apply: async (context) => {
      await context.writeText('outside.txt', 'escape\n');
    },
  });
  await assert.rejects(
    () => applyProjectUpgrade({ ...scopeFixture, migrationRegistry: [escapingMigration] }),
    (error) => error.code === 'MIGRATION_SCOPE_VIOLATION',
  );
  assert.equal(await exists(path.join(scopeFixture.targetRoot, 'outside.txt')), false);
  assert.equal(await fs.readFile(path.join(scopeFixture.targetRoot, 'managed/tool.txt'), 'utf8'), 'old tool\n');

  const symlinkFixture = await createMigrationFixture(t);
  const outside = await temporaryDirectory(t, 'monstrare-migration-outside-');
  await fs.unlink(path.join(symlinkFixture.targetRoot, 'data/state.json'));
  await fs.symlink(path.join(outside, 'state.json'), path.join(symlinkFixture.targetRoot, 'data/state.json'));
  await writeFile(outside, 'state.json', '{"schemaVersion":1}\n');
  await assert.rejects(
    () => applyProjectUpgrade({ ...symlinkFixture, migrationRegistry: [dataMigration()] }),
    (error) => error.code === 'MIGRATION_SYMLINK_UNSAFE',
  );
  assert.equal(await exists(path.join(symlinkFixture.targetRoot, '.monstrare/upgrade.lock')), false);
  assert.equal(await fs.readFile(path.join(outside, 'state.json'), 'utf8'), '{"schemaVersion":1}\n');
});

test('a migration cannot leave a managed file different from the source inventory', async (t) => {
  const fixture = await createMigrationFixture(t);
  const migration = {
    id: 'managed-tamper',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    allowedPaths: ['managed/tool.txt'],
    async check(context) {
      return (await context.readText('managed/tool.txt')) === 'migration-owned content\n'
        ? 'already-applied'
        : 'needed';
    },
    async apply(context) {
      await context.writeText('managed/tool.txt', 'migration-owned content\n');
    },
  };
  await assert.rejects(
    () => applyProjectUpgrade({ ...fixture, migrationRegistry: [migration] }),
    (error) => error.code === 'MIGRATION_MANAGED_PATH_CHANGED',
  );
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'managed/tool.txt'), 'utf8'), 'old tool\n');
  assert.deepEqual(await fs.readFile(path.join(fixture.targetRoot, '.monstrare/manifest.json')), fixture.originalManifest);
});

test('a migration write that bypasses the transaction context is rejected and restored', async (t) => {
  const fixture = await createMigrationFixture(t);
  const migration = dataMigration({
    apply: async () => {
      await fs.writeFile(path.join(fixture.targetRoot, 'data/state.json'), '{"schemaVersion":2,"bypassed":true}\n');
    },
  });
  await assert.rejects(
    () => applyProjectUpgrade({ ...fixture, migrationRegistry: [migration] }),
    (error) => error.code === 'MIGRATION_UNTRACKED_WRITE',
  );
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'data/state.json'), 'utf8'), '{"schemaVersion":1,"project":"kept"}\n');
  assert.equal(await fs.readFile(path.join(fixture.targetRoot, 'managed/tool.txt'), 'utf8'), 'old tool\n');
});

test('cards/epics migrations require validation and migrated data is readable by the board server', { timeout: 20_000 }, async (t) => {
  assert.throws(
    () => validateMigrationRegistry([{
      id: 'board-v2', fromVersion: '0.9.0', toVersion: '1.0.0',
      allowedPaths: ['tools/kanban/cards/**'],
      check: async () => 'needed', apply: async () => {},
    }]),
    (error) => error.code === 'MIGRATION_SCHEMA_VALIDATOR_REQUIRED',
  );

  const targetRoot = await temporaryDirectory(t, 'monstrare-migration-board-');
  await installProject({ sourceRoot: repositorySourceRoot, targetRoot });
  const oldCard = {
    id: 'TASK-901', title: 'Migrated', content: '', stage: 'backlog', risk: 'low', owner: '',
    approvalRequired: false, createdAt: '2026-09-18', epic: '', userStory: '', track: 'n/a',
    dependsOn: [], order: 1, readiness: {}, gates: {}, links: {}, refs: [], evidence: {}, comments: [],
  };
  await writeFile(targetRoot, 'tools/kanban/cards/TASK-901.json', `${JSON.stringify(oldCard)}\n`);
  await writeFile(targetRoot, 'tools/kanban/epics.json', '{"epics":[]}\n');
  const manifestPath = path.join(targetRoot, '.monstrare/manifest.json');
  const installed = await readInstallManifest(manifestPath);
  await writeInstallManifestAtomic(manifestPath, createInstallManifest({
    installedVersion: '0.9.0',
    installedAt: installed.installedAt,
    files: installed.files,
  }));

  const migration = {
    id: 'board-v2',
    fromVersion: '0.9.0',
    toVersion: '1.0.0',
    allowedPaths: ['tools/kanban/cards/**', 'tools/kanban/epics.json'],
    async check(context) {
      const card = await context.readJson('tools/kanban/cards/TASK-901.json');
      return typeof card.agent === 'string' ? 'already-applied' : 'needed';
    },
    async apply(context) {
      const card = await context.readJson('tools/kanban/cards/TASK-901.json');
      await context.writeJson('tools/kanban/cards/TASK-901.json', { ...card, agent: '' });
    },
    async validate(context) {
      const card = await context.readJson('tools/kanban/cards/TASK-901.json');
      const epics = await context.readJson('tools/kanban/epics.json');
      assert.equal(typeof card.agent, 'string');
      assert.ok(Array.isArray(epics.epics));
    },
  };
  const result = await applyProjectUpgrade({ sourceRoot: repositorySourceRoot, targetRoot, migrationRegistry: [migration] });
  assert.equal(result.migrations[0].status, 'applied');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(targetRoot, 'tools/kanban/cards/TASK-901.json'))).agent,
    '',
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(
      path.join(result.backupRoot, 'migrations/board-v2/files/tools/kanban/cards/TASK-901.json'),
    )),
    oldCard,
  );

  const child = execFile(
    process.execPath,
    [path.join(targetRoot, 'tools/kanban/server.mjs')],
    { env: { ...process.env, KANBAN_PORT: '0' } },
  );
  t.after(() => child.kill('SIGTERM'));
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('migrated kanban did not start')), 8_000);
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
  const response = await fetch(`${url}/api/cards`);
  assert.equal(response.status, 200);
  assert.equal((await response.json())[0].agent, '');
});
