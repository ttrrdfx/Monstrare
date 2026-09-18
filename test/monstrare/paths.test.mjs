import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PathSafetyError,
  normalizeRelativePath,
  resolvePathWithinRoot,
  resolveSafeRoot,
} from '../../scripts/lib/paths.mjs';

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('relative paths reject absolute, traversal, ambiguous separators, and null bytes', () => {
  assert.equal(normalizeRelativePath('tools/kanban/index.html'), 'tools/kanban/index.html');
  for (const unsafe of ['/etc/passwd', '../secret', 'a/../secret', './file', 'C:\\Windows\\file', 'C:relative', 'a\\b', 'a\0b']) {
    assert.throws(() => normalizeRelativePath(unsafe), PathSafetyError);
  }
});

test('safe roots reject filesystem root, home, and source root', async (t) => {
  const source = await temporaryDirectory('monstrare-root-');
  const target = await temporaryDirectory('monstrare-target-');
  t.after(() => Promise.all([
    fs.rm(source, { recursive: true, force: true }),
    fs.rm(target, { recursive: true, force: true }),
  ]));
  assert.equal(await resolveSafeRoot(target, { sourceRoot: source }), await fs.realpath(target));
  await assert.rejects(() => resolveSafeRoot(path.parse(target).root), /broad target/);
  await assert.rejects(() => resolveSafeRoot(os.homedir()), /broad target/);
  await assert.rejects(() => resolveSafeRoot(source, { sourceRoot: source }), /source root/);
});

test('target path resolution rejects symlink escape and permits an internal symlink', async (t) => {
  const root = await temporaryDirectory('monstrare-target-link-');
  const outside = await temporaryDirectory('monstrare-target-outside-');
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true }),
  ]));
  await fs.mkdir(path.join(root, 'inside'));
  await fs.writeFile(path.join(root, 'inside', 'file.txt'), 'ok');
  await fs.symlink(path.join(root, 'inside'), path.join(root, 'safe-link'));
  await fs.symlink(outside, path.join(root, 'escape-link'));

  assert.equal(
    await resolvePathWithinRoot(root, 'safe-link/file.txt', { mustExist: true }),
    await fs.realpath(path.join(root, 'inside', 'file.txt')),
  );
  await assert.rejects(
    () => resolvePathWithinRoot(root, 'escape-link/file.txt'),
    /symlink escapes root/,
  );
});
