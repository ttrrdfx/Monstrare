import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { readLegacyBaselines } from '../../scripts/lib/plan.mjs';

const execFileAsync = promisify(execFile);
export const fixturesRoot = path.join(import.meta.dirname, 'fixtures');

export async function copyFixtureTree(name, targetRoot) {
  await fs.cp(path.join(fixturesRoot, name), targetRoot, { recursive: true });
}

export async function materializeLegacyStockFixture({ sourceRoot, targetRoot }) {
  const baselines = await readLegacyBaselines(sourceRoot);
  const baseline = baselines.find(({ sourceRevision }) => sourceRevision === '7749c12');
  if (!baseline) throw new Error('legacy fixture baseline 7749c12 is not bundled');

  for (const relativePath of Object.keys(baseline.files)) {
    const destination = path.join(targetRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const { stdout } = await execFileAsync('git', ['show', `${baseline.sourceRevision}:${relativePath}`], {
      cwd: sourceRoot,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    });
    await fs.writeFile(destination, stdout);
  }
  return baseline;
}

export async function snapshotFixtureData(targetRoot) {
  const roots = ['ai/context', 'ai/artifacts', 'tools/kanban/cards'];
  const files = ['tools/kanban/epics.json'];

  async function walk(relativeDirectory) {
    let entries;
    try {
      entries = await fs.readdir(path.join(targetRoot, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await walk(relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  }

  for (const root of roots) await walk(root);
  const snapshot = {};
  for (const relativePath of files.sort()) {
    snapshot[relativePath] = await fs.readFile(path.join(targetRoot, relativePath), 'base64');
  }
  return snapshot;
}
