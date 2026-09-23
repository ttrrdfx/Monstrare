import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { installProject, InstallError, selectInstallEntries } from '../../scripts/lib/install.mjs';
import { readInstallManifest, sha256File } from '../../scripts/lib/manifest.mjs';

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(import.meta.dirname, '../..');

async function temporaryProject(t, prefix = 'monstrare-install-') {
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

test('install selection copies managed, preserves existing seeds, and excludes non-distributable files', () => {
  const inventory = [
    { path: 'managed.txt', ownership: 'managed', sha256: 'a' },
    { path: 'seed.txt', ownership: 'seed-only', sha256: 'b' },
    { path: 'data.json', ownership: 'project-data', sha256: 'c' },
    { path: 'source.md', ownership: 'source-only', sha256: 'd' },
  ];
  assert.deepEqual(
    selectInstallEntries(inventory, new Set(['seed.txt'])).map(({ path: file, action }) => [file, action]),
    [['managed.txt', 'copy'], ['seed.txt', 'preserve']],
  );
});

test('new install writes matching managed hashes and empty project-owned board data', async (t) => {
  const targetRoot = await temporaryProject(t);
  const result = await installProject({
    sourceRoot,
    targetRoot,
    installedAt: '2026-09-15T00:00:00.000Z',
  });
  const manifest = await readInstallManifest(path.join(targetRoot, '.monstrare', 'manifest.json'));

  assert.equal(manifest.installedVersion, '1.0.1');
  assert.equal(result.targetRoot, await fs.realpath(targetRoot));
  for (const [relativePath, record] of Object.entries(manifest.files)) {
    if (record.ownership === 'managed') {
      assert.equal(record.sha256, await sha256File(path.join(targetRoot, relativePath)), relativePath);
    }
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetRoot, 'tools/kanban/epics.json'))), { epics: [] });
  assert.deepEqual(await fs.readdir(path.join(targetRoot, 'tools/kanban/cards')), []);
  assert.equal(await exists(path.join(targetRoot, 'package.json')), false);
  assert.equal(await exists(path.join(targetRoot, 'ai/artifacts/Monstrare 版本升級機制')), false);
  assert.equal(await exists(path.join(targetRoot, 'tools/kanban/mockups')), false);
});

test('existing seeds and project data remain byte-for-byte unchanged', async (t) => {
  const targetRoot = await temporaryProject(t);
  const preserved = new Map([
    ['AGENTS.md', 'project agents\n'],
    ['.codex/config.toml', 'project config\n'],
    ['ai/context/README.md', 'project context\n'],
    ['ai/artifacts/README.md', 'project artifacts\n'],
    ['tools/kanban/cards/TASK-777.json', '{"project":true}\n'],
    ['tools/kanban/epics.json', '{"epics":[{"name":"Project"}]}\n'],
  ]);
  for (const [relativePath, contents] of preserved) {
    const destination = path.join(targetRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }

  const result = await installProject({ sourceRoot, targetRoot });

  for (const [relativePath, contents] of preserved) {
    assert.equal(await fs.readFile(path.join(targetRoot, relativePath), 'utf8'), contents, relativePath);
  }
  assert.ok(result.preserved.includes('AGENTS.md'));
  assert.ok(result.preserved.includes('.codex/config.toml'));
  const manifest = await readInstallManifest(path.join(targetRoot, '.monstrare/manifest.json'));
  assert.equal(manifest.files['AGENTS.md'].sha256, await sha256File(path.join(targetRoot, 'AGENTS.md')));
});

test('repeat install fails closed and points to status or upgrade', async (t) => {
  const targetRoot = await temporaryProject(t);
  await installProject({ sourceRoot, targetRoot });
  await assert.rejects(
    () => installProject({ sourceRoot, targetRoot }),
    (error) => error instanceof InstallError
      && error.code === 'ALREADY_INSTALLED'
      && /status or upgrade/.test(error.message),
  );
});

test('copy failure never leaves a completed install manifest', async (t) => {
  const targetRoot = await temporaryProject(t);
  let copies = 0;
  await assert.rejects(() => installProject({
    sourceRoot,
    targetRoot,
    copyFile: async (source, destination) => {
      copies += 1;
      if (copies === 2) throw new Error('simulated copy failure');
      await fs.copyFile(source, destination);
    },
  }), /simulated copy failure/);
  assert.equal(await exists(path.join(targetRoot, '.monstrare/manifest.json')), false);
});

test('target symlink escape is rejected before writing outside the project', async (t) => {
  const targetRoot = await temporaryProject(t);
  const outside = await temporaryProject(t, 'monstrare-install-outside-');
  await fs.symlink(outside, path.join(targetRoot, 'ai'));
  await assert.rejects(() => installProject({ sourceRoot, targetRoot }), /symlink escapes root/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('legacy shell wrapper installs a runnable board', { timeout: 20_000 }, async (t) => {
  const targetRoot = await temporaryProject(t);
  const wrapper = path.join(sourceRoot, 'scripts/install-into-project.sh');
  const { stdout } = await execFileAsync(wrapper, [targetRoot]);
  assert.match(stdout, /Installed Monstrare 1\.0\.1/);

  const child = execFile(
    process.execPath,
    [path.join(targetRoot, 'tools/kanban/server.mjs')],
    { env: { ...process.env, KANBAN_PORT: '0' } },
  );
  t.after(() => child.kill('SIGTERM'));
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('kanban did not start')), 8_000);
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
  assert.deepEqual(await cardsResponse.json(), []);
  assert.deepEqual(await epicsResponse.json(), { epics: [] });
});
