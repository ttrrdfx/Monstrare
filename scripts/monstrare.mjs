#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { installProject } from './lib/install.mjs';
import { formatPlan, planProjectUpgrade } from './lib/plan.mjs';
import { applyProjectUpgrade } from './lib/transaction.mjs';
import { formatVerification, verifyProject } from './lib/verify.mjs';

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
    this.code = 'CLI_USAGE';
    this.exitCode = 2;
  }
}

const COMMANDS = new Set(['install', 'status', 'upgrade', 'verify']);

export function parseCliArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new CliUsageError('usage: monstrare <install|status|upgrade|verify> <project> [--dry-run] [--json]');
  }
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) throw new CliUsageError(`unknown command: ${command}`);

  let project;
  let json = false;
  let dryRun = false;
  for (const argument of rest) {
    if (argument === '--json') json = true;
    else if (argument === '--dry-run') dryRun = true;
    else if (argument.startsWith('-')) throw new CliUsageError(`unknown option: ${argument}`);
    else if (project) throw new CliUsageError('exactly one project path is required');
    else project = argument;
  }
  if (!project) throw new CliUsageError('project path is required');
  if (dryRun && command !== 'upgrade') throw new CliUsageError('--dry-run is only valid with upgrade');
  if (json && !['status', 'upgrade'].includes(command)) throw new CliUsageError('--json is only valid with status or upgrade');
  return { command, project, dryRun, json };
}

export async function runCli(argv, io = process) {
  try {
    const options = parseCliArgs(argv);
    if (options.command === 'install') {
      const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const result = await installProject({ sourceRoot, targetRoot: options.project });
      io.stdout.write(`Installed Monstrare ${result.sourceVersion} into ${result.targetRoot}\n`);
      return 0;
    }
    if (options.command === 'status' || (options.command === 'upgrade' && options.dryRun)) {
      const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const plan = await planProjectUpgrade({ sourceRoot, targetRoot: options.project });
      io.stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan, {
        command: options.command === 'status' ? 'status' : 'upgrade dry-run',
      }));
      return plan.applicable ? 0 : 1;
    }
    if (options.command === 'upgrade') {
      const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const result = await applyProjectUpgrade({ sourceRoot, targetRoot: options.project });
      if (options.json) {
        io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (!result.changed) {
        io.stdout.write(`Monstrare ${result.plan.sourceVersion} is already up to date in ${result.targetRoot}\n`);
      } else {
        io.stdout.write(
          `Upgraded Monstrare ${result.plan.installedVersion} -> ${result.plan.sourceVersion} in ${result.targetRoot}\n`
          + `Backup: ${result.backupRoot}\n`
          + `Changed: ${result.changedPaths.length}\n`,
        );
      }
      return 0;
    }
    const result = await verifyProject({ targetRoot: options.project });
    io.stdout.write(formatVerification(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr.write(
      `${error.code ?? 'MONSTRARE_ERROR'}: ${error.message}`
      + `${error.backupRoot ? `\nBackup: ${error.backupRoot}` : ''}\n`,
    );
    return Number.isInteger(error.exitCode) ? error.exitCode : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runCli(process.argv.slice(2));
}
