import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ManifestError,
  assertUpgradeAllowed,
  classifyInventoryPath,
  compareSemVer,
  createInstallManifest,
  expandSourceInventory,
  readInstallManifest,
  readSourceManifest,
  serializeInstallManifest,
  sha256,
  validateSourceManifest,
  writeInstallManifestAtomic,
} from '../../scripts/lib/manifest.mjs';

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const baseSourceManifest = {
  schemaVersion: 1,
  version: '1.2.3',
  minimumNode: '20.0.0',
  managed: ['managed/**'],
  seedOnly: ['seed/*.md'],
  projectData: ['data/**'],
  sourceOnly: ['source-only.txt'],
};

test('strict SemVer comparison rejects malformed versions and downgrades', () => {
  assert.equal(compareSemVer('2.0.0', '1.99.99'), 1);
  assert.equal(compareSemVer('1.2.3', '1.2.3'), 0);
  assert.throws(() => compareSemVer('v1.2.3', '1.2.3'), ManifestError);
  assert.throws(() => compareSemVer('01.2.3', '1.2.3'), ManifestError);
  assert.throws(() => compareSemVer('9007199254740992.0.0', '1.2.3'), /too large/);
  assert.throws(() => assertUpgradeAllowed('2.0.0', '1.9.9'), /downgrade/);
});

test('SHA-256 is deterministic', () => {
  assert.equal(sha256('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('source inventory expands every ownership class in stable path order', async (t) => {
  const root = await temporaryDirectory('monstrare-source-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'managed'), { recursive: true });
  await fs.mkdir(path.join(root, 'seed'), { recursive: true });
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'managed', 'z.txt'), 'z');
  await fs.writeFile(path.join(root, 'managed', 'a.txt'), 'a');
  await fs.writeFile(path.join(root, 'seed', 'context.md'), 'seed');
  await fs.writeFile(path.join(root, 'data', 'card.json'), '{}');
  await fs.writeFile(path.join(root, 'source-only.txt'), 'private');

  const first = await expandSourceInventory(root, baseSourceManifest);
  const second = await expandSourceInventory(root, baseSourceManifest);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(({ path: file, ownership }) => [file, ownership]), [
    ['data/card.json', 'project-data'],
    ['managed/a.txt', 'managed'],
    ['managed/z.txt', 'managed'],
    ['seed/context.md', 'seed-only'],
    ['source-only.txt', 'source-only'],
  ]);
});

test('source manifest and expanded inventory reject ownership overlap', async (t) => {
  assert.throws(() => validateSourceManifest({
    ...baseSourceManifest,
    seedOnly: ['managed/**'],
  }), /overlaps/);

  const root = await temporaryDirectory('monstrare-overlap-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'managed'), { recursive: true });
  await fs.writeFile(path.join(root, 'managed', 'file.txt'), 'x');
  await assert.rejects(() => expandSourceInventory(root, {
    ...baseSourceManifest,
    seedOnly: ['managed/*.txt'],
  }), /overlapping ownership/);
});

test('pure inventory classification handles matches, misses, and overlaps', () => {
  assert.equal(classifyInventoryPath('managed/file.txt', baseSourceManifest), 'managed');
  assert.equal(classifyInventoryPath('unowned.txt', baseSourceManifest), null);
  assert.throws(() => classifyInventoryPath('managed/file.txt', {
    ...baseSourceManifest,
    seedOnly: ['managed/*.txt'],
  }), /overlapping ownership/);
});

test('source inventory rejects a symlink that escapes source root', async (t) => {
  const root = await temporaryDirectory('monstrare-source-link-');
  const outside = await temporaryDirectory('monstrare-outside-');
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true }),
  ]));
  await fs.mkdir(path.join(root, 'managed'));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'managed', 'escape.txt'));
  await assert.rejects(() => expandSourceInventory(root, baseSourceManifest), /symlink escapes root/);
});

test('install manifest round-trips deterministically without file contents', async (t) => {
  const root = await temporaryDirectory('monstrare-install-manifest-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, '.monstrare', 'manifest.json');
  const manifest = createInstallManifest({
    installedVersion: '1.2.3',
    installedAt: '2026-09-15T00:00:00.000Z',
    files: [
      { path: 'z.txt', ownership: 'managed', sha256: sha256('z') },
      { path: 'a.txt', ownership: 'seed-only', sha256: sha256('a') },
    ],
  });
  await writeInstallManifestAtomic(filePath, manifest);
  const actual = await readInstallManifest(filePath, { sourceVersion: '1.2.3' });
  assert.deepEqual(actual, manifest);
  assert.equal(serializeInstallManifest(actual).includes('contents'), false);
  assert.deepEqual(Object.keys(actual.files), ['a.txt', 'z.txt']);
});

test('manifest readers fail closed for malformed JSON, unknown schemas, and downgrade', async (t) => {
  const root = await temporaryDirectory('monstrare-invalid-manifest-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const malformed = path.join(root, 'malformed.json');
  await fs.writeFile(malformed, '{ nope');
  await assert.rejects(() => readSourceManifest(malformed), /malformed/);

  const unknown = path.join(root, 'unknown.json');
  await fs.writeFile(unknown, JSON.stringify({ ...baseSourceManifest, schemaVersion: 99 }));
  await assert.rejects(() => readSourceManifest(unknown), /unsupported/);

  const install = path.join(root, 'install.json');
  await fs.writeFile(install, serializeInstallManifest(createInstallManifest({
    installedVersion: '2.0.0',
    installedAt: '2026-09-15T00:00:00.000Z',
    files: {},
  })));
  await assert.rejects(() => readInstallManifest(install, { sourceVersion: '1.0.0' }), /downgrade/);

  assert.throws(() => createInstallManifest({
    installedVersion: '1.0.0',
    installedAt: '2026-09-15T00:00:00.000Z',
    files: [
      { path: 'same.txt', ownership: 'managed', sha256: sha256('first') },
      { path: 'same.txt', ownership: 'managed', sha256: sha256('second') },
    ],
  }), /duplicate/);
  assert.throws(() => validateSourceManifest({ ...baseSourceManifest, injected: true }), /unsupported field/);
  assert.throws(() => validateSourceManifest({ ...baseSourceManifest, managed: ['C:relative'] }), /must be relative/);
  assert.throws(() => serializeInstallManifest({
    ...createInstallManifest({
      installedVersion: '1.0.0',
      installedAt: '2026-09-15T00:00:00.000Z',
      files: {},
    }),
    contents: 'must not be accepted',
  }), /unsupported field/);
  assert.throws(() => createInstallManifest({
    installedVersion: '1.0.0',
    installedAt: '2026-09-15T00:00:00.000Z',
    files: [{ path: 'private.txt', ownership: 'source-only', sha256: sha256('private') }],
  }), /unknown ownership/);
});
