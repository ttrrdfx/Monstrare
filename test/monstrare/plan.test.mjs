import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { installProject } from '../../scripts/lib/install.mjs';
import { sha256 } from '../../scripts/lib/manifest.mjs';
import {
  buildUpgradePlan,
  formatPlan,
  planProjectUpgrade,
  readLegacyBaselines,
  selectLegacyBaseline,
} from '../../scripts/lib/plan.mjs';

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(import.meta.dirname, '../..');

async function temporaryProject(t, prefix = 'monstrare-plan-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function snapshotTree(root, logical = '') {
  const entries = await fs.readdir(path.join(root, logical), { withFileTypes: true });
  const result = {};
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = logical ? `${logical}/${entry.name}` : entry.name;
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    result[relative] = {
      type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
      mtimeMs: stat.mtimeMs,
      sha256: entry.isFile() ? sha256(await fs.readFile(absolute)) : null,
    };
    if (entry.isDirectory()) Object.assign(result, await snapshotTree(root, relative));
  }
  return result;
}

function makePlan(overrides = {}) {
  return buildUpgradePlan({
    targetRoot: '/tmp/project',
    sourceVersion: '2.0.0',
    installedVersion: '1.0.0',
    manifestStatus: 'present',
    sourceInventory: [],
    installedFiles: {},
    targetFiles: {},
    ...overrides,
  });
}

test('plan truth table classifies add, update, preserve, conflict, and project ownership', () => {
  const old = sha256('old');
  const current = sha256('current');
  const modified = sha256('modified');
  const plan = makePlan({
    sourceInventory: [
      { path: 'add.txt', ownership: 'managed', sha256: current },
      { path: 'update.txt', ownership: 'managed', sha256: current },
      { path: 'same.txt', ownership: 'managed', sha256: current },
      { path: 'modified.txt', ownership: 'managed', sha256: current },
      { path: 'seed-existing.md', ownership: 'seed-only', sha256: current },
      { path: 'seed-missing.md', ownership: 'seed-only', sha256: current },
      { path: 'data.json', ownership: 'project-data', sha256: current },
      { path: 'source-only.txt', ownership: 'source-only', sha256: current },
    ],
    installedFiles: {
      'update.txt': { ownership: 'managed', sha256: old },
      'same.txt': { ownership: 'managed', sha256: old },
      'modified.txt': { ownership: 'managed', sha256: old },
    },
    targetFiles: {
      'update.txt': { exists: true, type: 'file', sha256: old },
      'same.txt': { exists: true, type: 'file', sha256: current },
      'modified.txt': { exists: true, type: 'file', sha256: modified },
      'seed-existing.md': { exists: true, type: 'file', sha256: modified },
      'data.json': { exists: true, type: 'file', sha256: modified },
    },
  });

  assert.deepEqual(plan.files.map(({ path: file, action }) => [file, action]), [
    ['add.txt', 'add'],
    ['data.json', 'preserve'],
    ['modified.txt', 'conflict'],
    ['same.txt', 'preserve'],
    ['seed-existing.md', 'preserve'],
    ['seed-missing.md', 'add'],
    ['update.txt', 'update'],
  ]);
  assert.deepEqual(plan.summary, { add: 2, update: 1, remove: 0, preserve: 3, conflict: 1 });
  assert.deepEqual(plan.localModifications, { count: 1, paths: ['modified.txt'] });
  assert.equal(plan.applicable, false);
});

test('removed upstream managed files are removed only when unmodified', () => {
  const old = sha256('old');
  const plan = makePlan({
    installedFiles: {
      'clean.txt': { ownership: 'managed', sha256: old },
      'changed.txt': { ownership: 'managed', sha256: old },
      'seed.md': { ownership: 'seed-only', sha256: old },
    },
    targetFiles: {
      'clean.txt': { exists: true, type: 'file', sha256: old },
      'changed.txt': { exists: true, type: 'file', sha256: sha256('changed') },
      'seed.md': { exists: true, type: 'file', sha256: sha256('project') },
    },
  });
  assert.deepEqual(plan.files.map(({ path: file, action, reason }) => [file, action, reason]), [
    ['changed.txt', 'conflict', 'removed-upstream-modified'],
    ['clean.txt', 'remove', 'removed-upstream-unmodified'],
    ['seed.md', 'preserve', 'seed-owned-by-project'],
  ]);
});

test('legacy selection is conservative and rejects unknown or ambiguous targets', () => {
  const baseline = {
    version: '0.0.0',
    sourceRevision: 'abcdef0',
    files: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
      `${index}.txt`, { ownership: 'managed', sha256: `${index}` },
    ])),
  };
  const recognized = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `${index}.txt`, { exists: true, type: 'file', sha256: index === 9 ? 'modified' : `${index}` },
  ]));
  assert.equal(selectLegacyBaseline([baseline], recognized), baseline);
  assert.throws(() => selectLegacyBaseline([baseline], {}), /does not uniquely match/);
  assert.throws(() => selectLegacyBaseline([baseline, { ...baseline, sourceRevision: 'bbbbbbb' }], recognized), /uniquely/);
});

test('manifest install status and repeated dry-runs are byte- and mtime-read-only', async (t) => {
  const targetRoot = await temporaryProject(t);
  await installProject({ sourceRoot, targetRoot, installedAt: '2026-09-15T00:00:00.000Z' });
  const before = await snapshotTree(targetRoot);
  const first = await planProjectUpgrade({ sourceRoot, targetRoot });
  const second = await planProjectUpgrade({ sourceRoot, targetRoot });
  const after = await snapshotTree(targetRoot);

  assert.equal(first.manifestStatus, 'present');
  assert.equal(first.installedVersion, '1.0.0');
  assert.equal(first.applicable, true);
  assert.deepEqual(second, first);
  assert.deepEqual(after, before);
});

test('a project without a manifest or recognizable legacy files fails closed without writes', async (t) => {
  const targetRoot = await temporaryProject(t, 'monstrare-unknown-legacy-');
  await fs.writeFile(path.join(targetRoot, 'package.json'), '{"private":true}\n');
  const before = await snapshotTree(targetRoot);
  await assert.rejects(
    () => planProjectUpgrade({ sourceRoot, targetRoot }),
    (error) => error.code === 'LEGACY_UNRECOGNIZED',
  );
  assert.deepEqual(await snapshotTree(targetRoot), before);
});

test('bundled 7749c12 fixture is recognized and one managed edit creates one conflict', { timeout: 20_000 }, async (t) => {
  const targetRoot = await temporaryProject(t, 'monstrare-legacy-');
  const [baseline] = await readLegacyBaselines(sourceRoot);
  assert.equal(baseline.sourceRevision, '7749c12');

  for (const relativePath of Object.keys(baseline.files)) {
    const destination = path.join(targetRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const { stdout } = await execFileAsync('git', ['show', `${baseline.sourceRevision}:${relativePath}`], {
      cwd: sourceRoot,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(crypto.createHash('sha256').update(stdout).digest('hex'), baseline.files[relativePath].sha256);
    await fs.writeFile(destination, stdout);
  }

  const stock = await planProjectUpgrade({ sourceRoot, targetRoot });
  assert.equal(stock.manifestStatus, 'legacy');
  assert.equal(stock.installedVersion, '0.0.0');
  assert.equal(stock.legacyRevision, '7749c12');
  assert.equal(stock.applicable, true);
  assert.ok(stock.summary.update > 0);
  assert.equal(stock.summary.remove, 0);

  const changedPath = 'tools/kanban/server.mjs';
  await fs.appendFile(path.join(targetRoot, changedPath), '\n// downstream customization\n');
  const customized = await planProjectUpgrade({ sourceRoot, targetRoot });
  assert.equal(customized.applicable, false);
  assert.equal(customized.summary.conflict, 1);
  assert.deepEqual(
    customized.files.filter(({ action }) => action === 'conflict').map(({ path: file }) => file),
    [changedPath],
  );
  assert.doesNotMatch(JSON.stringify(customized), /downstream customization/);
});

test('human output is a direct rendering of the same stable plan object', () => {
  const plan = makePlan({
    sourceInventory: [{ path: 'new.txt', ownership: 'managed', sha256: sha256('new') }],
  });
  const output = formatPlan(plan, { command: 'upgrade dry-run' });
  assert.match(output, /Source version: 2\.0\.0/);
  assert.match(output, /Local modifications: 0/);
  assert.match(output, /Summary: add 1, update 0, remove 0, preserve 0, conflict 0/);
  for (const entry of plan.files) assert.match(output, new RegExp(entry.path.replace('.', '\\.')));
  assert.equal(JSON.parse(JSON.stringify(plan)).files.length, plan.files.length);
});
