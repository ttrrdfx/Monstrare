import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildVerificationChecks,
  formatVerification,
  runVerificationCommand,
  verifyProject,
} from '../../scripts/lib/verify.mjs';

async function temporaryProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'monstrare-verify-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeFile(root, relativePath, contents = '') {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents);
}

test('verify reports every missing project check and returns a failure', async (t) => {
  const targetRoot = await temporaryProject(t);
  const result = await verifyProject({
    targetRoot,
    runCommand: async () => {
      throw new Error('missing checks must not execute commands');
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.map(({ id, status }) => [id, status]), [
    ['governance', 'missing'],
    ['board-tests', 'missing'],
    ['node-syntax', 'missing'],
    ['shell-syntax', 'missing'],
  ]);
  const output = formatVerification(result);
  assert.match(output, /Verification failed/);
  assert.match(output, /scripts\/check-governance\.sh not found/);
  assert.match(output, /tools\/kanban\/\*\.test\.mjs not found/);
});

test('verify discovers fixed governance, test, and syntax commands without a shell', async (t) => {
  const targetRoot = await temporaryProject(t);
  await writeFile(targetRoot, 'scripts/check-governance.sh', '#!/usr/bin/env bash\n');
  await writeFile(targetRoot, 'scripts/monstrare.mjs', 'export {};\n');
  await writeFile(targetRoot, 'scripts/lib/example.mjs', 'export {};\n');
  await writeFile(targetRoot, 'tools/kanban/server.mjs', 'export {};\n');
  await writeFile(targetRoot, 'tools/kanban/example.test.mjs', 'export {};\n');

  const planned = await buildVerificationChecks(targetRoot);
  assert.equal(planned.every(({ status }) => status !== 'missing'), true);
  const invoked = [];
  const result = await verifyProject({
    targetRoot,
    runCommand: async (command, args, options) => {
      invoked.push({ command, args, options });
      return { ok: true, exitCode: 0, stdout: '', stderr: '', error: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(invoked.every(({ options }) => options.cwd === result.targetRoot), true);
  assert.ok(invoked.some(({ command, args }) => command === 'bash' && args[0] === 'scripts/check-governance.sh'));
  assert.ok(invoked.some(({ args }) => args[0] === '--test' && args.includes('tools/kanban/example.test.mjs')));
  assert.ok(invoked.some(({ args }) => args[0] === '--check' && args[1] === 'scripts/lib/example.mjs'));
  assert.ok(invoked.some(({ command, args }) => command === 'bash' && args[0] === '-n'));
});

test('verify preserves a failed command result and clips command output', async (t) => {
  const targetRoot = await temporaryProject(t);
  await writeFile(targetRoot, 'scripts/check-governance.sh', '#!/usr/bin/env bash\n');
  await writeFile(targetRoot, 'scripts/example.sh', '#!/usr/bin/env bash\n');
  await writeFile(targetRoot, 'scripts/monstrare.mjs', 'export {};\n');
  await writeFile(targetRoot, 'tools/kanban/server.mjs', 'export {};\n');
  await writeFile(targetRoot, 'tools/kanban/example.test.mjs', 'export {};\n');

  const result = await verifyProject({
    targetRoot,
    runCommand: async (_command, args) => (args[0] === '--test'
      ? { ok: false, exitCode: 1, stdout: '', stderr: 'fixture test failed', error: '' }
      : { ok: true, exitCode: 0, stdout: '', stderr: '', error: '' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(({ id }) => id === 'board-tests').status, 'failed');
  assert.match(formatVerification(result), /fixture test failed/);
});

test('verification commands do not inherit unrelated source-process secrets', async (t) => {
  const targetRoot = await temporaryProject(t);
  const key = 'MONSTRARE_VERIFY_FIXTURE_SECRET';
  const previous = process.env[key];
  process.env[key] = 'must-not-cross-the-boundary';
  try {
    const result = await runVerificationCommand(
      process.execPath,
      ['--input-type=module', '-e', `process.exit(process.env.${key} ? 1 : 0)`],
      { cwd: targetRoot },
    );
    assert.equal(result.ok, true, result.stderr || result.stdout || result.error);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
