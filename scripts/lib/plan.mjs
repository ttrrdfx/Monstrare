import fs from 'node:fs/promises';
import path from 'node:path';

import {
  expandSourceInventory,
  readInstallManifest,
  readJsonFile,
  readSourceManifest,
  sha256File,
  validateInstallManifest,
} from './manifest.mjs';
import { normalizeRelativePath, resolvePathWithinRoot, resolveSafeRoot } from './paths.mjs';

export const PLAN_SCHEMA_VERSION = 1;
export const PLAN_ACTIONS = Object.freeze(['add', 'update', 'remove', 'preserve', 'conflict']);
const INSTALL_MANIFEST_PATH = '.monstrare/manifest.json';
const planSnapshots = new WeakMap();

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class PlanError extends Error {
  constructor(message, code = 'PLAN_FAILED') {
    super(message);
    this.name = 'PlanError';
    this.code = code;
    this.exitCode = 1;
  }
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function inspectTargetPath(targetRoot, relativePath) {
  const safePath = normalizeRelativePath(relativePath, 'plan path');
  const absolute = await resolvePathWithinRoot(targetRoot, safePath);
  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, type: 'missing' };
    throw error;
  }
  if (stat.isSymbolicLink()) return { exists: true, type: 'symlink' };
  if (!stat.isFile()) return { exists: true, type: stat.isDirectory() ? 'directory' : 'other' };
  return { exists: true, type: 'file', sha256: await sha256File(absolute) };
}

function addEntry(entries, pathName, ownership, action, reason) {
  entries.push({ path: pathName, ownership, action, reason });
}

export function buildUpgradePlan({
  targetRoot,
  sourceVersion,
  installedVersion,
  manifestStatus,
  legacyRevision = null,
  sourceInventory,
  installedFiles,
  targetFiles,
}) {
  const sourceByPath = new Map(sourceInventory.map((entry) => [entry.path, entry]));
  const entries = [];

  for (const source of sourceInventory) {
    if (source.ownership === 'source-only') continue;
    const target = targetFiles[source.path] ?? { exists: false, type: 'missing' };

    if (source.ownership === 'project-data') {
      if (target.exists) addEntry(entries, source.path, source.ownership, 'preserve', 'project-owned');
      continue;
    }
    if (source.ownership === 'seed-only') {
      addEntry(
        entries,
        source.path,
        source.ownership,
        target.exists ? 'preserve' : 'add',
        target.exists ? 'seed-owned-by-project' : 'missing-seed',
      );
      continue;
    }

    const previous = installedFiles[source.path];
    if (!target.exists) {
      addEntry(entries, source.path, source.ownership, 'add', 'missing-managed');
    } else if (target.type !== 'file') {
      addEntry(entries, source.path, source.ownership, 'conflict', `managed-target-is-${target.type}`);
    } else if (target.sha256 === source.sha256) {
      addEntry(entries, source.path, source.ownership, 'preserve', 'matches-source');
    } else if (previous?.ownership === 'managed' && target.sha256 === previous.sha256) {
      addEntry(entries, source.path, source.ownership, 'update', 'managed-unmodified');
    } else {
      addEntry(
        entries,
        source.path,
        source.ownership,
        'conflict',
        previous ? 'managed-modified' : 'untracked-managed-path',
      );
    }
  }

  for (const [pathName, previous] of Object.entries(installedFiles)) {
    const source = sourceByPath.get(pathName);
    if (source && source.ownership !== 'source-only') continue;
    const target = targetFiles[pathName] ?? { exists: false, type: 'missing' };
    if (!target.exists) continue;
    if (previous.ownership === 'seed-only') {
      addEntry(entries, pathName, previous.ownership, 'preserve', 'seed-owned-by-project');
    } else if (target.type === 'file' && target.sha256 === previous.sha256) {
      addEntry(entries, pathName, previous.ownership, 'remove', 'removed-upstream-unmodified');
    } else {
      addEntry(entries, pathName, previous.ownership, 'conflict', 'removed-upstream-modified');
    }
  }

  entries.sort((left, right) => compareStrings(left.path, right.path));
  const summary = Object.fromEntries(PLAN_ACTIONS.map((action) => [
    action,
    entries.filter((entry) => entry.action === action).length,
  ]));
  const localModificationPaths = entries
    .filter(({ action }) => action === 'conflict')
    .map(({ path: pathName }) => pathName);
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    targetRoot,
    sourceVersion,
    installedVersion,
    manifestStatus,
    legacyRevision,
    applicable: summary.conflict === 0,
    summary,
    localModifications: {
      count: localModificationPaths.length,
      paths: localModificationPaths,
    },
    files: entries,
  };
}

function validateLegacyBaseline(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlanError(`${label} must be an object`, 'LEGACY_BASELINE_INVALID');
  }
  const supportedKeys = new Set(['schemaVersion', 'version', 'sourceRevision', 'files']);
  const unsupportedKey = Object.keys(value).find((key) => !supportedKeys.has(key));
  if (unsupportedKey) {
    throw new PlanError(`${label} contains unsupported field: ${unsupportedKey}`, 'LEGACY_BASELINE_INVALID');
  }
  const manifest = validateInstallManifest({
    schemaVersion: value?.schemaVersion,
    installedVersion: value?.version,
    installedAt: '1970-01-01T00:00:00.000Z',
    files: value?.files,
  });
  if (typeof value.sourceRevision !== 'string' || !/^[a-f0-9]{7,40}$/.test(value.sourceRevision)) {
    throw new PlanError(`${label} has an invalid sourceRevision`, 'LEGACY_BASELINE_INVALID');
  }
  if (Object.keys(manifest.files).length === 0
      || Object.values(manifest.files).some(({ ownership }) => ownership !== 'managed')) {
    throw new PlanError(`${label} must contain at least one managed file`, 'LEGACY_BASELINE_INVALID');
  }
  return {
    version: manifest.installedVersion,
    sourceRevision: value.sourceRevision,
    files: manifest.files,
  };
}

export async function readLegacyBaselines(sourceRoot) {
  const directory = path.join(sourceRoot, 'scripts', 'manifests');
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const baselines = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort(compareStrings)) {
    const filePath = path.join(directory, name);
    baselines.push(validateLegacyBaseline(await readJsonFile(filePath, `legacy baseline ${name}`), name));
  }
  return baselines;
}

export function selectLegacyBaseline(baselines, targetFiles) {
  const candidates = baselines.flatMap((baseline) => {
    const records = Object.entries(baseline.files);
    const present = records.filter(([pathName]) => targetFiles[pathName]?.type === 'file').length;
    const exact = records.filter(([pathName, record]) => targetFiles[pathName]?.sha256 === record.sha256).length;
    // Path shape plus a large majority of exact hashes identifies the release while
    // still allowing a small number of downstream edits to surface as conflicts.
    const requiredPresent = Math.ceil(records.length * 0.8);
    const requiredExact = Math.max(3, Math.ceil(records.length * 0.8));
    return present >= requiredPresent && exact >= requiredExact ? [{ baseline, exact }] : [];
  }).sort((left, right) => right.exact - left.exact);

  if (candidates.length === 0 || (candidates[1] && candidates[0].exact === candidates[1].exact)) {
    throw new PlanError(
      'target has no install manifest and does not uniquely match a bundled legacy baseline',
      'LEGACY_UNRECOGNIZED',
    );
  }
  return candidates[0].baseline;
}

async function inspectPaths(targetRoot, paths) {
  const result = {};
  for (const pathName of [...new Set(paths)].sort(compareStrings)) {
    result[pathName] = await inspectTargetPath(targetRoot, pathName);
  }
  return result;
}

export function getPlanSnapshot(plan) {
  const snapshot = planSnapshots.get(plan);
  if (!snapshot) {
    throw new PlanError('upgrade plan is missing its integrity snapshot', 'PLAN_SNAPSHOT_MISSING');
  }
  return structuredClone(snapshot);
}

export async function planProjectUpgrade({ sourceRoot, targetRoot } = {}) {
  const resolvedSource = await fs.realpath(sourceRoot);
  const resolvedTarget = await resolveSafeRoot(targetRoot, { sourceRoot: resolvedSource });
  const sourceManifest = await readSourceManifest(path.join(resolvedSource, 'monstrare-package.json'));
  const sourceInventory = await expandSourceInventory(resolvedSource, sourceManifest);
  const manifestPath = await resolvePathWithinRoot(resolvedTarget, INSTALL_MANIFEST_PATH);

  let installedVersion;
  let manifestStatus;
  let legacyRevision = null;
  let installedFiles;

  if (await pathExists(manifestPath)) {
    const manifest = await readInstallManifest(manifestPath, { sourceVersion: sourceManifest.version });
    installedVersion = manifest.installedVersion;
    manifestStatus = 'present';
    installedFiles = manifest.files;
  } else {
    const baselines = await readLegacyBaselines(resolvedSource);
    const legacyPaths = baselines.flatMap((baseline) => Object.keys(baseline.files));
    const legacyTargetFiles = await inspectPaths(resolvedTarget, legacyPaths);
    const baseline = selectLegacyBaseline(baselines, legacyTargetFiles);
    installedVersion = baseline.version;
    manifestStatus = 'legacy';
    legacyRevision = baseline.sourceRevision;
    installedFiles = baseline.files;
  }

  const planPaths = [
    ...sourceInventory
      .filter(({ ownership }) => ownership !== 'source-only')
      .map(({ path: pathName }) => pathName),
    ...Object.keys(installedFiles),
  ];
  const targetFiles = await inspectPaths(resolvedTarget, planPaths);
  const plan = buildUpgradePlan({
    targetRoot: resolvedTarget,
    sourceVersion: sourceManifest.version,
    installedVersion,
    manifestStatus,
    legacyRevision,
    sourceInventory,
    installedFiles,
    targetFiles,
  });
  planSnapshots.set(plan, {
    sourceInventory,
    targetFiles,
    installManifest: await pathExists(manifestPath)
      ? { exists: true, sha256: await sha256File(manifestPath) }
      : { exists: false },
  });
  return plan;
}

export function formatPlan(plan, { command = 'status' } = {}) {
  const lines = [
    `Monstrare ${command} for ${plan.targetRoot}`,
    `Source version: ${plan.sourceVersion}`,
    `Installed version: ${plan.installedVersion}${plan.legacyRevision ? ` (legacy ${plan.legacyRevision})` : ''}`,
    `Manifest: ${plan.manifestStatus}`,
    `Applicable: ${plan.applicable ? 'yes' : 'no'}`,
    `Local modifications: ${plan.localModifications.count}`,
    `Summary: ${PLAN_ACTIONS.map((action) => `${action} ${plan.summary[action]}`).join(', ')}`,
  ];
  for (const action of PLAN_ACTIONS) {
    const files = plan.files.filter((entry) => entry.action === action);
    if (files.length === 0) continue;
    lines.push('', `${action.toUpperCase()} (${files.length})`);
    for (const entry of files) lines.push(`  ${entry.path} — ${entry.reason}`);
  }
  return `${lines.join('\n')}\n`;
}
