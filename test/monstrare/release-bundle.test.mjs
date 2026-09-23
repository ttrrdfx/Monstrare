import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installProject } from '../../scripts/lib/install.mjs';
import { sha256 } from '../../scripts/lib/manifest.mjs';
import { planProjectUpgrade } from '../../scripts/lib/plan.mjs';
import {
  RELEASE_BUNDLE_LIMITS,
  ReleaseBundleError,
  buildReleaseBundle,
  materializeReleaseBundle,
  parseReleaseBundle,
  serializeReleaseBundle,
  validateReleaseBundle,
} from '../../scripts/lib/release-bundle.mjs';

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const commitSha = 'a'.repeat(40);

async function temporaryDirectory(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function fileRecord(filePath, content, ownership = 'managed', mode = 0o644) {
  const bytes = Buffer.from(content);
  return {
    path: filePath,
    ownership,
    mode,
    sha256: sha256(bytes),
    contentBase64: bytes.toString('base64'),
  };
}

function fixtureBundle(extraFiles = []) {
  const manifest = {
    schemaVersion: 1,
    version: '1.2.3',
    minimumNode: '20.0.0',
    managed: ['VERSION', 'monstrare-package.json', 'managed/**'],
    seedOnly: ['seed/**'],
    projectData: ['data/**'],
    sourceOnly: ['private/**'],
  };
  return {
    schemaVersion: 1,
    version: '1.2.3',
    createdFrom: commitSha,
    files: [
      fileRecord('monstrare-package.json', `${JSON.stringify(manifest, null, 2)}\n`),
      fileRecord('VERSION', '1.2.3\n'),
      ...extraFiles,
    ],
  };
}

function mutateBundle(mutator) {
  const bundle = structuredClone(fixtureBundle());
  mutator(bundle);
  return bundle;
}

test('validator normalizes stable order and serializer emits canonical bytes', () => {
  const bundle = fixtureBundle([
    fileRecord('seed/z.md', 'z', 'seed-only'),
    fileRecord('managed/a.txt', 'a'),
  ]);
  const first = serializeReleaseBundle(bundle);
  const second = serializeReleaseBundle(JSON.parse(first));
  assert.equal(second, first);
  assert.deepEqual(parseReleaseBundle(first).files.map(({ path: filePath }) => filePath), [
    'VERSION',
    'managed/a.txt',
    'monstrare-package.json',
    'seed/z.md',
  ]);
  assert.equal(Object.isFrozen(validateReleaseBundle(bundle)), true);
});

test('validator rejects unsupported schema, malformed versions, commits, and fields', () => {
  assert.throws(() => validateReleaseBundle({ ...fixtureBundle(), schemaVersion: 2 }), /unsupported.*schema/);
  assert.throws(() => validateReleaseBundle({ ...fixtureBundle(), version: 'v1.2.3' }), /strict major/);
  assert.throws(() => validateReleaseBundle({ ...fixtureBundle(), createdFrom: 'abc123' }), /commit SHA/);
  assert.throws(() => validateReleaseBundle({ ...fixtureBundle(), injected: true }), /unsupported field/);
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[0].injected = true;
  })), /unsupported field/);
  assert.throws(() => validateReleaseBundle(fixtureBundle(), { expectedVersion: '1.2.4' }), /expected version/);
});

test('validator rejects unsafe, empty, duplicate, and platform-specific paths', () => {
  for (const unsafe of ['', '/absolute', '../escape', 'a/../escape', 'a\\escape', 'C:/escape', 'nul\0path']) {
    assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
      bundle.files[0].path = unsafe;
    })), ReleaseBundleError, unsafe);
  }
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[1].path = bundle.files[0].path;
  })), /duplicate/);
});

test('validator rejects ownership, mode, hash, base64, and embedded contract mismatches', () => {
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[0].ownership = 'project-data';
  })), /ownership/);
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[0].mode = 0o600;
  })), /mode/);
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[0].sha256 = '0'.repeat(64);
  })), /sha256 mismatch/);
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[0].contentBase64 = 'not base64';
  })), /canonical base64/);
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[1] = fileRecord('VERSION', '9.9.9\n');
  })), /VERSION does not match/);
  assert.throws(() => validateReleaseBundle(fixtureBundle([
    fileRecord('data/card.json', '{}', 'managed'),
  ])), /ownership mismatch/);
});

test('malformed JSON errors never echo bundle file contents', () => {
  const secret = 'do-not-echo-this-content';
  assert.throws(
    () => parseReleaseBundle(`{"${secret}":`),
    (error) => error instanceof ReleaseBundleError && !error.message.includes(secret),
  );
  assert.throws(() => validateReleaseBundle(mutateBundle((bundle) => {
    bundle.files[0] = fileRecord('monstrare-package.json', `{"${secret}":`);
  })), (error) => error instanceof ReleaseBundleError && !error.message.includes(secret));
});

test('hard ceilings cannot be raised and file count rejects 5001 entries before decoding', () => {
  assert.throws(() => validateReleaseBundle(fixtureBundle(), {
    limits: { maxFiles: RELEASE_BUNDLE_LIMITS.maxFiles + 1 },
  }), /hard release bundle limit/);
  assert.throws(() => validateReleaseBundle({
    ...fixtureBundle(),
    files: Array.from({ length: 5001 }, () => null),
  }), /exceeds 5000 files/);
});

test('validator enforces encoded, per-file, and total decoded size ceilings', () => {
  const bundle = fixtureBundle([
    fileRecord('managed/a.txt', '1234'),
    fileRecord('managed/b.txt', '5678'),
  ]);
  const serializedBytes = Buffer.byteLength(serializeReleaseBundle(bundle));
  assert.throws(() => validateReleaseBundle(bundle, {
    limits: { maxBundleBytes: serializedBytes - 1 },
  }), /exceeds.*bytes/);
  assert.throws(() => validateReleaseBundle(bundle, {
    limits: { maxFileBytes: 3 },
  }), /decoded file exceeds/);

  const requiredDecodedBytes = validateReleaseBundle(fixtureBundle()).files.reduce(
    (total, file) => total + Buffer.from(file.contentBase64, 'base64').byteLength,
    0,
  );
  assert.throws(() => validateReleaseBundle(bundle, {
    limits: { maxDecodedBytes: requiredDecodedBytes + 7 },
  }), /decoded content exceeds/);
  assert.throws(() => parseReleaseBundle(serializeReleaseBundle(bundle), {
    limits: { maxBundleBytes: serializedBytes - 1 },
  }), /exceeds.*bytes/);
});

test('materializer validates everything before writing and requires an empty root', async (t) => {
  const targetRoot = await temporaryDirectory(t, 'monstrare-bundle-target-');
  const invalid = mutateBundle((bundle) => {
    bundle.files[0].sha256 = '0'.repeat(64);
  });
  await assert.rejects(() => materializeReleaseBundle({ bundle: invalid, targetRoot }), /sha256 mismatch/);
  assert.deepEqual(await fs.readdir(targetRoot), []);

  await fs.writeFile(path.join(targetRoot, 'existing.txt'), 'keep');
  await assert.rejects(() => materializeReleaseBundle({ bundle: fixtureBundle(), targetRoot }), /must be empty/);
  assert.equal(await fs.readFile(path.join(targetRoot, 'existing.txt'), 'utf8'), 'keep');
});

test('real source builds reproducibly without project data or source-only files', { timeout: 30_000 }, async () => {
  const first = serializeReleaseBundle(await buildReleaseBundle({ sourceRoot, createdFrom: commitSha }));
  const second = serializeReleaseBundle(await buildReleaseBundle({ sourceRoot, createdFrom: commitSha }));
  assert.equal(sha256(first), sha256(second));
  assert.equal(first, second);

  const bundle = parseReleaseBundle(first);
  const paths = new Set(bundle.files.map(({ path: filePath }) => filePath));
  assert.equal(paths.has('VERSION'), true);
  assert.equal(paths.has('monstrare-package.json'), true);
  assert.equal(paths.has('scripts/manifests/legacy-7749c12.json'), true);
  assert.equal(paths.has('tools/kanban/epics.json'), false);
  assert.equal([...paths].some((filePath) => filePath.startsWith('tools/kanban/cards/')), false);
  assert.equal(
    [...paths].some((filePath) => filePath.startsWith('ai/artifacts/') && filePath !== 'ai/artifacts/README.md'),
    false,
  );
  assert.equal(paths.has('package.json'), false);
});

test('materialized real bundle is a planner-compatible sourceRoot', { timeout: 30_000 }, async (t) => {
  const targetRoot = await temporaryDirectory(t, 'monstrare-bundle-project-');
  const materializedRoot = await temporaryDirectory(t, 'monstrare-bundle-source-');
  await installProject({ sourceRoot, targetRoot, installedAt: '2026-09-21T00:00:00.000Z' });
  const serialized = serializeReleaseBundle(await buildReleaseBundle({ sourceRoot, createdFrom: commitSha }));
  await materializeReleaseBundle({ bundle: serialized, targetRoot: materializedRoot, expectedVersion: '1.0.0' });

  const plan = await planProjectUpgrade({ sourceRoot: materializedRoot, targetRoot });
  assert.equal(plan.sourceVersion, '1.0.0');
  assert.equal(plan.installedVersion, '1.0.0');
  assert.equal(plan.applicable, true);
  assert.equal(plan.summary.conflict, 0);
});

test('builder rejects symlink semantics and unsupported source modes', async (t) => {
  const root = await temporaryDirectory(t, 'monstrare-bundle-builder-');
  const manifest = {
    schemaVersion: 1,
    version: '1.2.3',
    minimumNode: '20.0.0',
    managed: ['VERSION', 'monstrare-package.json', 'managed/**'],
    seedOnly: [],
    projectData: [],
    sourceOnly: [],
  };
  await fs.mkdir(path.join(root, 'managed'));
  await fs.writeFile(path.join(root, 'VERSION'), '1.2.3\n');
  await fs.writeFile(path.join(root, 'monstrare-package.json'), `${JSON.stringify(manifest)}\n`);
  await fs.symlink('../VERSION', path.join(root, 'managed', 'link.txt'));
  await assert.rejects(() => buildReleaseBundle({ sourceRoot: root, createdFrom: commitSha }), /symlinks/);

  await fs.unlink(path.join(root, 'managed', 'link.txt'));
  await fs.writeFile(path.join(root, 'managed', 'mode.txt'), 'mode');
  await fs.chmod(path.join(root, 'managed', 'mode.txt'), 0o600);
  await assert.rejects(() => buildReleaseBundle({ sourceRoot: root, createdFrom: commitSha }), /unsupported mode/);
});
