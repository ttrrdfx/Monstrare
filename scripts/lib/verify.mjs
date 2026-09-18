import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveSafeRoot } from './paths.mjs';

export const VERIFY_SCHEMA_VERSION = 1;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_DETAIL_CHARS = 4_000;
const ENVIRONMENT_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
  'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PATHEXT',
];

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function regularFileExists(filePath) {
  try {
    return (await fs.lstat(filePath)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function collectFiles(root, relativeDirectory, predicate) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, relativePath, predicate));
    else if (entry.isFile() && predicate(relativePath)) files.push(relativePath);
  }
  return files;
}

function clipDetail(value) {
  const text = String(value ?? '').trim();
  if (text.length <= MAX_DETAIL_CHARS) return text;
  return `...${text.slice(-MAX_DETAIL_CHARS)}`;
}

export function runVerificationCommand(command, args, { cwd } = {}) {
  const env = Object.fromEntries(ENVIRONMENT_KEYS.flatMap((key) => (
    process.env[key] === undefined ? [] : [[key, process.env[key]]]
  )));
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: 120_000,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        exitCode: error?.code ?? 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        error: error?.message ?? '',
      });
    });
  });
}

function missingCheck(id, label, detail) {
  return { id, label, status: 'missing', commands: [], detail };
}

async function executeCheck({ id, label, commands }, targetRoot, runCommand) {
  const failures = [];
  for (const command of commands) {
    const result = await runCommand(command.command, command.args, { cwd: targetRoot });
    if (!result.ok) {
      failures.push(clipDetail([
        result.stderr,
        result.stdout,
        result.error,
      ].filter(Boolean).join('\n')));
    }
  }
  return {
    id,
    label,
    status: failures.length === 0 ? 'passed' : 'failed',
    commands: commands.map(({ display }) => display),
    detail: failures.join('\n'),
  };
}

export async function buildVerificationChecks(targetRoot) {
  const checks = [];
  const governancePath = 'scripts/check-governance.sh';
  if (await regularFileExists(path.join(targetRoot, governancePath))) {
    checks.push({
      id: 'governance',
      label: 'governance self-check',
      commands: [{
        command: 'bash',
        args: [governancePath],
        display: `bash ${governancePath}`,
      }],
    });
  } else {
    checks.push(missingCheck('governance', 'governance self-check', `${governancePath} not found`));
  }

  const boardTests = (await collectFiles(
    targetRoot,
    'tools/kanban',
    (relativePath) => path.posix.dirname(relativePath) === 'tools/kanban'
      && relativePath.endsWith('.test.mjs'),
  )).sort(compareStrings);
  if (boardTests.length > 0) {
    checks.push({
      id: 'board-tests',
      label: 'kanban tests',
      commands: [{
        command: process.execPath,
        args: ['--test', ...boardTests],
        display: `node --test ${boardTests.join(' ')}`,
      }],
    });
  } else {
    checks.push(missingCheck('board-tests', 'kanban tests', 'tools/kanban/*.test.mjs not found'));
  }

  const requiredModules = ['scripts/monstrare.mjs', 'tools/kanban/server.mjs'];
  const modulePaths = [
    ...await collectFiles(targetRoot, 'scripts', (relativePath) => relativePath.endsWith('.mjs')),
    ...requiredModules,
  ].filter((relativePath, index, values) => values.indexOf(relativePath) === index);
  const existingModules = [];
  for (const relativePath of modulePaths.sort(compareStrings)) {
    if (await regularFileExists(path.join(targetRoot, relativePath))) existingModules.push(relativePath);
  }
  const missingModules = [];
  for (const relativePath of requiredModules) {
    if (!existingModules.includes(relativePath)) missingModules.push(relativePath);
  }
  if (missingModules.length === 0) {
    checks.push({
      id: 'node-syntax',
      label: 'Node.js syntax',
      commands: existingModules.map((relativePath) => ({
        command: process.execPath,
        args: ['--check', relativePath],
        display: `node --check ${relativePath}`,
      })),
    });
  } else {
    checks.push(missingCheck(
      'node-syntax',
      'Node.js syntax',
      `required module${missingModules.length === 1 ? '' : 's'} not found: ${missingModules.join(', ')}`,
    ));
  }

  const shellPaths = (await collectFiles(
    targetRoot,
    'scripts',
    (relativePath) => relativePath.endsWith('.sh'),
  )).sort(compareStrings);
  if (shellPaths.length > 0) {
    checks.push({
      id: 'shell-syntax',
      label: 'shell syntax',
      commands: shellPaths.map((relativePath) => ({
        command: 'bash',
        args: ['-n', relativePath],
        display: `bash -n ${relativePath}`,
      })),
    });
  } else {
    checks.push(missingCheck('shell-syntax', 'shell syntax', 'scripts/*.sh not found'));
  }

  return checks;
}

export async function verifyProject({ targetRoot, runCommand = runVerificationCommand } = {}) {
  const resolvedTarget = await resolveSafeRoot(targetRoot);
  const plannedChecks = await buildVerificationChecks(resolvedTarget);
  const checks = [];
  for (const check of plannedChecks) {
    checks.push(check.status === 'missing'
      ? check
      : await executeCheck(check, resolvedTarget, runCommand));
  }
  return {
    schemaVersion: VERIFY_SCHEMA_VERSION,
    targetRoot: resolvedTarget,
    ok: checks.every(({ status }) => status === 'passed'),
    checks,
  };
}

export function formatVerification(result) {
  const lines = [
    `Verification ${result.ok ? 'passed' : 'failed'}: ${result.targetRoot}`,
  ];
  for (const check of result.checks) {
    lines.push(`${check.status.toUpperCase()} ${check.label}`);
    if (check.detail) lines.push(`  ${check.detail.replaceAll('\n', '\n  ')}`);
  }
  return `${lines.join('\n')}\n`;
}
