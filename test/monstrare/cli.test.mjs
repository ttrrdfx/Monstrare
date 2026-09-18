import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installProject } from '../../scripts/lib/install.mjs';
import { CliUsageError, parseCliArgs, runCli } from '../../scripts/monstrare.mjs';

const sourceRoot = path.resolve(import.meta.dirname, '../..');

test('CLI parser produces a stable command contract', () => {
  assert.deepEqual(parseCliArgs(['upgrade', '/tmp/project', '--dry-run', '--json']), {
    command: 'upgrade', project: '/tmp/project', dryRun: true, json: true,
  });
  assert.deepEqual(parseCliArgs(['install', '/tmp/project']), {
    command: 'install', project: '/tmp/project', dryRun: false, json: false,
  });
});

test('CLI parser rejects unknown commands, options, and invalid option scope', () => {
  for (const args of [[], ['nope', '/tmp/project'], ['status'], ['verify', '/tmp/project', '--json'], ['status', '/tmp/project', '--dry-run']]) {
    assert.throws(() => parseCliArgs(args), CliUsageError);
  }
});

test('CLI returns a consistent non-zero boundary for usage errors', async () => {
  let stderr = '';
  const io = { stdout: { write: () => {} }, stderr: { write: (value) => { stderr += value; } } };
  assert.equal(await runCli(['status'], io), 2);
  assert.match(stderr, /^CLI_USAGE:/);
});

test('status and upgrade dry-run expose the same JSON plan', async (t) => {
  const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'monstrare-cli-'));
  t.after(() => fs.rm(targetRoot, { recursive: true, force: true }));
  await installProject({ sourceRoot, targetRoot });

  async function invoke(args) {
    let stdout = '';
    let stderr = '';
    const io = {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    };
    const exitCode = await runCli(args, io);
    return { exitCode, stdout, stderr };
  }

  const status = await invoke(['status', targetRoot, '--json']);
  const dryRun = await invoke(['upgrade', targetRoot, '--dry-run', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(status.stderr, '');
  assert.equal(dryRun.stderr, '');
  assert.deepEqual(JSON.parse(status.stdout), JSON.parse(dryRun.stdout));

  await fs.appendFile(path.join(targetRoot, 'tools/kanban/server.mjs'), '\n// local-only marker\n');
  const conflict = await invoke(['upgrade', targetRoot, '--dry-run', '--json']);
  const conflictPlan = JSON.parse(conflict.stdout);
  assert.equal(conflict.exitCode, 1);
  assert.deepEqual(conflictPlan.localModifications, {
    count: 1,
    paths: ['tools/kanban/server.mjs'],
  });
  assert.doesNotMatch(conflict.stdout, /local-only marker/);
});

test('upgrade apply reports a current installation as a no-op', async (t) => {
  const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'monstrare-cli-upgrade-'));
  t.after(() => fs.rm(targetRoot, { recursive: true, force: true }));
  await installProject({ sourceRoot, targetRoot });
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(['upgrade', targetRoot, '--json'], {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.changed, false);
  assert.equal(result.backupRoot, null);
});
