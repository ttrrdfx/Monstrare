#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReleaseBundle, serializeReleaseBundle } from './lib/release-bundle.mjs';
import { sha256 } from './lib/manifest.mjs';

const DEFAULT_SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class PackageReleaseUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackageReleaseUsageError';
    this.code = 'PACKAGE_RELEASE_USAGE';
    this.exitCode = 2;
  }
}

export function parsePackageReleaseArgs(argv) {
  const options = { sourceRoot: DEFAULT_SOURCE_ROOT, outputPath: null, createdFrom: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (!['--source', '--output', '--created-from'].includes(argument)) {
      throw new PackageReleaseUsageError(`unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new PackageReleaseUsageError(`${argument} requires a value`);
    }
    index += 1;
    if (argument === '--source') options.sourceRoot = path.resolve(value);
    if (argument === '--output') options.outputPath = path.resolve(value);
    if (argument === '--created-from') options.createdFrom = value;
  }
  if (!options.createdFrom) throw new PackageReleaseUsageError('--created-from is required');
  return options;
}

function usage() {
  return 'usage: package-release --created-from <full-commit-sha> [--source <directory>] [--output <file>]\n';
}

export async function runPackageRelease(argv, io = process) {
  try {
    const options = parsePackageReleaseArgs(argv);
    if (options.help) {
      io.stdout.write(usage());
      return 0;
    }
    const bundle = await buildReleaseBundle({
      sourceRoot: options.sourceRoot,
      createdFrom: options.createdFrom,
    });
    const serialized = serializeReleaseBundle(bundle);
    const outputPath = options.outputPath
      ?? path.resolve(`monstrare-v${bundle.version}.bundle.json`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    io.stdout.write(`${outputPath}\nsha256 ${sha256(serialized)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error.code ?? 'PACKAGE_RELEASE_ERROR'}: ${error.message}\n`);
    return Number.isInteger(error.exitCode) ? error.exitCode : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runPackageRelease(process.argv.slice(2));
}
