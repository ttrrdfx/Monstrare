import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createInstallManifest,
  expandSourceInventory,
  readSourceManifest,
  sha256File,
  writeInstallManifestAtomic,
} from './manifest.mjs';
import {
  executeMigrations,
  prepareMigrations,
  rollbackMigrations,
} from './migrations.mjs';
import { getPlanSnapshot, inspectTargetPath, planProjectUpgrade } from './plan.mjs';
import { normalizeRelativePath, resolvePathWithinRoot, resolveSafeRoot } from './paths.mjs';
import { migrations as productionMigrations } from '../migrations/index.mjs';

const INSTALL_MANIFEST_PATH = '.monstrare/manifest.json';
const LOCK_PATH = '.monstrare/upgrade.lock';
const JOURNAL_SCHEMA_VERSION = 1;

const JOURNAL_TRANSITIONS = Object.freeze({
  created: new Set(['backup-complete', 'rolling-back']),
  'backup-complete': new Set(['staging-complete', 'rolling-back']),
  'staging-complete': new Set(['applying', 'rolling-back']),
  applying: new Set(['manifest-written', 'rolling-back']),
  'manifest-written': new Set(['completed', 'rolling-back']),
  'rolling-back': new Set(['rolled-back', 'rollback-failed']),
  completed: new Set(),
  'rolled-back': new Set(),
  'rollback-failed': new Set(),
});

export class UpgradeError extends Error {
  constructor(message, code = 'UPGRADE_FAILED', details = {}) {
    super(message);
    this.name = 'UpgradeError';
    this.code = code;
    this.exitCode = 1;
    Object.assign(this, details);
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function stableJson(value) {
  return JSON.stringify(value);
}

export function transitionJournal(journal, nextState, extra = {}) {
  const allowed = JOURNAL_TRANSITIONS[journal.state];
  if (!allowed?.has(nextState)) {
    throw new UpgradeError(
      `invalid transaction journal transition: ${journal.state} -> ${nextState}`,
      'JOURNAL_STATE_INVALID',
    );
  }
  return { ...journal, ...extra, state: nextState };
}

export function orderMutationEntries(files) {
  return files
    .filter(({ action }) => ['add', 'update', 'remove'].includes(action))
    .sort((left, right) => compareStrings(left.path, right.path));
}

async function assertNoSymlinkComponents(root, relativePath, { allowMissingLeaf = true } = {}) {
  const safe = normalizeRelativePath(relativePath, 'transaction path');
  const resolvedRoot = await fs.realpath(root);
  let current = resolvedRoot;
  const segments = safe.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT' && (allowMissingLeaf || index < segments.length - 1)) return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new UpgradeError(`transaction path contains a symlink: ${safe}`, 'UPGRADE_SYMLINK_UNSAFE');
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new UpgradeError(`transaction parent is not a directory: ${safe}`, 'UPGRADE_PATH_UNSAFE');
    }
  }
}

async function ensureSafeDirectory(root, relativeDirectory, createdDirectories = new Set(), { mode } = {}) {
  const safe = normalizeRelativePath(relativeDirectory, 'transaction directory');
  const resolvedRoot = await fs.realpath(root);
  let current = resolvedRoot;
  let logical = '';
  for (const segment of safe.split('/')) {
    logical = logical ? `${logical}/${segment}` : segment;
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(current, mode === undefined ? undefined : { mode });
      createdDirectories.add(logical);
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new UpgradeError(`unsafe transaction directory: ${logical}`, 'UPGRADE_PATH_UNSAFE');
    }
  }
  return current;
}

async function ensureSafeParent(root, relativePath, createdDirectories = new Set()) {
  const directory = path.posix.dirname(normalizeRelativePath(relativePath, 'transaction path'));
  if (directory !== '.') await ensureSafeDirectory(root, directory, createdDirectories);
  await assertNoSymlinkComponents(root, relativePath);
  return resolvePathWithinRoot(root, relativePath);
}

async function copyFileAtomic(sourcePath, targetRoot, relativePath, {
  expectedSha256,
  createdDirectories = new Set(),
  exclusive = false,
} = {}) {
  const destination = await ensureSafeParent(targetRoot, relativePath, createdDirectories);
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.copyFile(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
    const sourceStat = await fs.stat(sourcePath);
    await fs.chmod(temporary, sourceStat.mode & 0o777);
    if (expectedSha256 && await sha256File(temporary) !== expectedSha256) {
      throw new UpgradeError(`staged file checksum changed: ${relativePath}`, 'UPGRADE_SOURCE_STALE');
    }
    if (exclusive && await pathExists(destination)) {
      throw new UpgradeError(`target appeared during upgrade: ${relativePath}`, 'UPGRADE_TARGET_STALE');
    }
    await assertNoSymlinkComponents(targetRoot, relativePath);
    await fs.rename(temporary, destination);
    return destination;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function acquireLock(targetRoot, lockData, createdDirectories) {
  await ensureSafeDirectory(targetRoot, '.monstrare', createdDirectories, { mode: 0o700 });
  const lockPath = await ensureSafeParent(targetRoot, LOCK_PATH, createdDirectories);
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(lockData, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }
    if (error.code === 'EEXIST') {
      throw new UpgradeError(`another upgrade lock exists at ${lockPath}`, 'UPGRADE_LOCKED');
    }
    throw error;
  }
  await handle.close();
  return lockPath;
}

async function releaseLock(lockPath, token) {
  let lock;
  try {
    const stat = await fs.lstat(lockPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new UpgradeError('upgrade lock type changed before release', 'UPGRADE_LOCK_LOST');
    }
    lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new UpgradeError('upgrade lock disappeared before release', 'UPGRADE_LOCK_LOST');
    }
    throw new UpgradeError('upgrade lock became unreadable before release', 'UPGRADE_LOCK_LOST');
  }
  if (lock.token !== token) {
    throw new UpgradeError('upgrade lock ownership changed before release', 'UPGRADE_LOCK_LOST');
  }
  await fs.unlink(lockPath);
}

async function samePathState(targetRoot, relativePath, expected) {
  const current = await inspectTargetPath(targetRoot, relativePath);
  return stableJson(current) === stableJson(expected);
}

async function assertPlanFresh({ sourceRoot, targetRoot, plan, snapshot }) {
  const currentPlan = await planProjectUpgrade({ sourceRoot, targetRoot });
  const currentSnapshot = getPlanSnapshot(currentPlan);
  if (stableJson(currentPlan) !== stableJson(plan)
      || stableJson(currentSnapshot) !== stableJson(snapshot)) {
    throw new UpgradeError('upgrade plan is stale; run dry-run again', 'UPGRADE_PLAN_STALE');
  }
}

async function removeCreatedDirectories(targetRoot, createdDirectories) {
  const directories = [...createdDirectories]
    .filter((entry) => !entry.startsWith('.monstrare'))
    .sort((left, right) => right.split('/').length - left.split('/').length || compareStrings(right, left));
  for (const relativePath of directories) {
    const absolute = await resolvePathWithinRoot(targetRoot, relativePath);
    await fs.rmdir(absolute).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    });
  }
}

async function rollbackTouched({
  targetRoot,
  touched,
  backupRoot,
  createdDirectories,
  manifestAppliedSha256,
  oldManifestExists,
}) {
  for (const entry of [...touched].reverse()) {
    const current = await inspectTargetPath(targetRoot, entry.path);
    if (entry.action === 'add') {
      if (current.type !== 'file' || current.sha256 !== entry.appliedSha256) {
        throw new UpgradeError(`cannot safely roll back changed added file: ${entry.path}`, 'UPGRADE_ROLLBACK_CONFLICT');
      }
      await fs.unlink(await resolvePathWithinRoot(targetRoot, entry.path, { mustExist: true }));
    } else if (entry.action === 'update') {
      if (current.type !== 'file' || current.sha256 !== entry.appliedSha256) {
        throw new UpgradeError(`cannot safely roll back changed updated file: ${entry.path}`, 'UPGRADE_ROLLBACK_CONFLICT');
      }
      await copyFileAtomic(path.join(backupRoot, 'files', entry.path), targetRoot, entry.path);
    } else if (entry.action === 'remove') {
      if (current.exists) {
        throw new UpgradeError(`cannot safely roll back recreated removed file: ${entry.path}`, 'UPGRADE_ROLLBACK_CONFLICT');
      }
      await copyFileAtomic(path.join(backupRoot, 'files', entry.path), targetRoot, entry.path);
    }
  }

  if (manifestAppliedSha256) {
    const manifestPath = await resolvePathWithinRoot(targetRoot, INSTALL_MANIFEST_PATH);
    const current = await inspectTargetPath(targetRoot, INSTALL_MANIFEST_PATH);
    if (current.type !== 'file' || current.sha256 !== manifestAppliedSha256) {
      throw new UpgradeError('cannot safely roll back changed install manifest', 'UPGRADE_ROLLBACK_CONFLICT');
    }
    if (oldManifestExists) {
      await copyFileAtomic(path.join(backupRoot, 'manifest.json'), targetRoot, INSTALL_MANIFEST_PATH);
    } else {
      await fs.rm(manifestPath, { force: true });
    }
  }
  await removeCreatedDirectories(targetRoot, createdDirectories);
}

function makeBackupName(now, fromVersion, toVersion, token) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${fromVersion}-to-${toVersion}-${token.slice(0, 8)}`;
}

async function buildNextManifest({ targetRoot, plan, installedAt }) {
  const records = [];
  for (const entry of plan.files) {
    if (!['managed', 'seed-only'].includes(entry.ownership)
        || ['remove', 'conflict'].includes(entry.action)) continue;
    const inspected = await inspectTargetPath(targetRoot, entry.path);
    if (inspected.type !== 'file') {
      throw new UpgradeError(`installed file is missing before manifest commit: ${entry.path}`, 'UPGRADE_TARGET_STALE');
    }
    records.push({ path: entry.path, ownership: entry.ownership, sha256: inspected.sha256 });
  }
  return createInstallManifest({
    installedVersion: plan.sourceVersion,
    installedAt,
    files: records,
  });
}

export async function applyProjectUpgrade({
  sourceRoot,
  targetRoot,
  plan: suppliedPlan,
  installedAt,
  now = () => new Date(),
  faultInjector = async () => {},
  migrationRegistry = productionMigrations,
} = {}) {
  const resolvedSource = await fs.realpath(sourceRoot);
  const resolvedTarget = await resolveSafeRoot(targetRoot, { sourceRoot: resolvedSource });
  const plan = suppliedPlan ?? await planProjectUpgrade({ sourceRoot: resolvedSource, targetRoot: resolvedTarget });
  if (plan.targetRoot !== resolvedTarget) {
    throw new UpgradeError('upgrade plan target does not match requested target', 'UPGRADE_PLAN_TARGET_MISMATCH');
  }
  if (!plan.applicable) {
    const conflicts = plan.files.filter(({ action }) => action === 'conflict').map(({ path: file }) => file);
    throw new UpgradeError(
      `upgrade has conflicts and made no changes: ${conflicts.join(', ')}`,
      'UPGRADE_CONFLICT',
      { conflicts },
    );
  }

  const preparedMigrations = await prepareMigrations({
    targetRoot: resolvedTarget,
    fromVersion: plan.installedVersion,
    toVersion: plan.sourceVersion,
    registry: migrationRegistry,
  });

  const mutations = orderMutationEntries(plan.files);
  const snapshot = getPlanSnapshot(plan);
  if (mutations.length === 0 && plan.sourceVersion === plan.installedVersion) {
    await assertPlanFresh({ sourceRoot: resolvedSource, targetRoot: resolvedTarget, plan, snapshot });
    return { changed: false, targetRoot: resolvedTarget, plan, backupRoot: null, changedPaths: [] };
  }

  const token = crypto.randomUUID();
  const startedAt = now();
  const createdDirectories = new Set();
  const touched = [];
  const migrationRollbackRecords = [];
  const migrationResults = preparedMigrations.map(({ migration, status }) => ({
    id: migration.id,
    status,
    touchedPaths: [],
  }));
  let lockPath;
  let backupRoot;
  let stagingRoot;
  let journalPath;
  let journal;
  let manifestAppliedSha256;
  let committed = false;
  const oldManifestExists = snapshot.installManifest.exists;

  try {
    lockPath = await acquireLock(resolvedTarget, {
      schemaVersion: 1,
      token,
      pid: process.pid,
      acquiredAt: startedAt.toISOString(),
      fromVersion: plan.installedVersion,
      toVersion: plan.sourceVersion,
    }, createdDirectories);
    await faultInjector('lock-acquired', { plan });
    await assertPlanFresh({ sourceRoot: resolvedSource, targetRoot: resolvedTarget, plan, snapshot });

    const backupRelative = `.monstrare/backups/${makeBackupName(startedAt, plan.installedVersion, plan.sourceVersion, token)}`;
    backupRoot = await ensureSafeDirectory(
      resolvedTarget,
      backupRelative,
      createdDirectories,
      { mode: 0o700 },
    );
    journalPath = path.join(backupRoot, 'journal.json');
    journal = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      transactionId: token,
      state: 'created',
      startedAt: startedAt.toISOString(),
      fromVersion: plan.installedVersion,
      toVersion: plan.sourceVersion,
      files: mutations.map(({ path: file, action }) => ({ path: file, action })),
      touched: [],
      migrations: migrationResults,
    };
    await writeJsonAtomic(journalPath, journal);

    for (const entry of mutations.filter(({ action }) => ['update', 'remove'].includes(action))) {
      const expected = snapshot.targetFiles[entry.path];
      await assertNoSymlinkComponents(resolvedTarget, entry.path, { allowMissingLeaf: false });
      if (!await samePathState(resolvedTarget, entry.path, expected)) {
        throw new UpgradeError(`target changed after planning: ${entry.path}`, 'UPGRADE_TARGET_STALE');
      }
      const source = await resolvePathWithinRoot(resolvedTarget, entry.path, { mustExist: true });
      await copyFileAtomic(source, backupRoot, `files/${entry.path}`, {
        expectedSha256: expected.sha256,
        exclusive: true,
      });
    }
    if (oldManifestExists) {
      const manifestPath = await resolvePathWithinRoot(resolvedTarget, INSTALL_MANIFEST_PATH, { mustExist: true });
      await copyFileAtomic(manifestPath, backupRoot, 'manifest.json', {
        expectedSha256: snapshot.installManifest.sha256,
        exclusive: true,
      });
    }
    journal = transitionJournal(journal, 'backup-complete');
    await writeJsonAtomic(journalPath, journal);
    await faultInjector('backup-complete', { plan, backupRoot });

    const stagingRelative = `.monstrare/staging/${token}`;
    stagingRoot = await ensureSafeDirectory(
      resolvedTarget,
      stagingRelative,
      createdDirectories,
      { mode: 0o700 },
    );
    const sourceManifest = await readSourceManifest(path.join(resolvedSource, 'monstrare-package.json'));
    const sourceInventory = await expandSourceInventory(resolvedSource, sourceManifest);
    if (stableJson(sourceInventory) !== stableJson(snapshot.sourceInventory)) {
      throw new UpgradeError('source changed after planning', 'UPGRADE_SOURCE_STALE');
    }
    const sourceByPath = new Map(sourceInventory.map((entry) => [entry.path, entry]));
    for (const entry of mutations.filter(({ action }) => ['add', 'update'].includes(action))) {
      const sourceEntry = sourceByPath.get(entry.path);
      if (!sourceEntry) throw new UpgradeError(`source file disappeared: ${entry.path}`, 'UPGRADE_SOURCE_STALE');
      const source = await resolvePathWithinRoot(resolvedSource, entry.path, { mustExist: true });
      await copyFileAtomic(source, stagingRoot, entry.path, {
        expectedSha256: sourceEntry.sha256,
        exclusive: true,
      });
    }
    journal = transitionJournal(journal, 'staging-complete');
    await writeJsonAtomic(journalPath, journal);
    await faultInjector('staging-complete', { plan, backupRoot });

    journal = transitionJournal(journal, 'applying');
    await writeJsonAtomic(journalPath, journal);
    for (const entry of mutations) {
      const expected = snapshot.targetFiles[entry.path] ?? { exists: false, type: 'missing' };
      if (!await samePathState(resolvedTarget, entry.path, expected)) {
        throw new UpgradeError(`target changed after planning: ${entry.path}`, 'UPGRADE_TARGET_STALE');
      }
      await faultInjector('before-apply-file', { entry, touched: [...touched] });
      if (entry.action === 'remove') {
        await assertNoSymlinkComponents(resolvedTarget, entry.path, { allowMissingLeaf: false });
        await fs.unlink(await resolvePathWithinRoot(resolvedTarget, entry.path, { mustExist: true }));
        touched.push({ ...entry });
      } else {
        const sourceEntry = sourceByPath.get(entry.path);
        await copyFileAtomic(path.join(stagingRoot, entry.path), resolvedTarget, entry.path, {
          expectedSha256: sourceEntry.sha256,
          createdDirectories,
          exclusive: entry.action === 'add',
        });
        touched.push({ ...entry, appliedSha256: sourceEntry.sha256 });
      }
      journal = { ...journal, touched: touched.map(({ path: file, action }) => ({ path: file, action })) };
      await writeJsonAtomic(journalPath, journal);
      await faultInjector('after-apply-file', { entry, touched: [...touched] });
    }

    for (const entry of plan.files.filter(({ ownership, action }) => ownership === 'managed' && action !== 'remove')) {
      const sourceEntry = sourceByPath.get(entry.path);
      const current = await inspectTargetPath(resolvedTarget, entry.path);
      if (!sourceEntry || current.type !== 'file' || current.sha256 !== sourceEntry.sha256) {
        throw new UpgradeError(`managed target changed before manifest commit: ${entry.path}`, 'UPGRADE_TARGET_STALE');
      }
    }

    await faultInjector('before-migrations', { plan, backupRoot });
    const appliedMigrations = await executeMigrations({
      targetRoot: resolvedTarget,
      backupRoot,
      prepared: preparedMigrations,
      rollbackRecords: migrationRollbackRecords,
      onProgress: async (progress) => {
        const index = migrationResults.findIndex(({ id }) => id === progress.id);
        migrationResults[index] = progress;
        journal = { ...journal, migrations: migrationResults };
        await writeJsonAtomic(journalPath, journal);
        if (progress.status === 'applied') {
          await faultInjector('after-migration', { plan, backupRoot, migration: progress });
        }
      },
    });
    await faultInjector('after-migrations', { plan, backupRoot, migrations: appliedMigrations });

    // A migration may read managed files, but it must not leave them diverged
    // from the source inventory that the install manifest represents.
    for (const entry of plan.files.filter(({ ownership, action }) => ownership === 'managed' && action !== 'remove')) {
      const sourceEntry = sourceByPath.get(entry.path);
      const current = await inspectTargetPath(resolvedTarget, entry.path);
      if (!sourceEntry || current.type !== 'file' || current.sha256 !== sourceEntry.sha256) {
        throw new UpgradeError(`migration changed a managed target: ${entry.path}`, 'MIGRATION_MANAGED_PATH_CHANGED');
      }
    }

    const manifest = await buildNextManifest({
      targetRoot: resolvedTarget,
      plan,
      installedAt: installedAt ?? now().toISOString(),
    });
    await faultInjector('before-manifest', { plan, backupRoot });
    const manifestPath = await ensureSafeParent(resolvedTarget, INSTALL_MANIFEST_PATH, createdDirectories);
    await writeInstallManifestAtomic(manifestPath, manifest);
    manifestAppliedSha256 = await sha256File(manifestPath);
    await faultInjector('after-manifest', { plan, backupRoot });
    journal = transitionJournal(journal, 'manifest-written');
    await writeJsonAtomic(journalPath, journal);
    journal = transitionJournal(journal, 'completed', { completedAt: now().toISOString() });
    await writeJsonAtomic(journalPath, journal);
    committed = true;

    await fs.rm(stagingRoot, { recursive: true, force: true });
    await releaseLock(lockPath, token);
    return {
      changed: true,
      targetRoot: resolvedTarget,
      plan,
      backupRoot,
      changedPaths: [...new Set([
        ...mutations.map(({ path: file }) => file),
        ...appliedMigrations.flatMap(({ touchedPaths }) => touchedPaths),
      ])].sort(compareStrings),
      migrations: migrationResults,
      manifest,
    };
  } catch (error) {
    let rollbackError;
    if (!committed && journal) {
      try {
        journal = transitionJournal(journal, 'rolling-back', {
          failure: { code: error.code ?? 'UPGRADE_FAILED', message: error.message },
        });
        await writeJsonAtomic(journalPath, journal);
        await rollbackMigrations({
          targetRoot: resolvedTarget,
          rollbackRecords: migrationRollbackRecords,
        });
        await rollbackTouched({
          targetRoot: resolvedTarget,
          touched,
          backupRoot,
          createdDirectories,
          manifestAppliedSha256,
          oldManifestExists,
        });
        journal = transitionJournal(journal, 'rolled-back', { rolledBackAt: now().toISOString() });
        await writeJsonAtomic(journalPath, journal);
      } catch (caught) {
        rollbackError = caught;
        if (journal && journal.state === 'rolling-back') {
          journal = transitionJournal(journal, 'rollback-failed', {
            rollbackFailure: { code: caught.code ?? 'ROLLBACK_FAILED', message: caught.message },
          });
          await writeJsonAtomic(journalPath, journal).catch(() => {});
        }
      }
    }
    if (stagingRoot) await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    let lockError;
    if (lockPath) {
      try {
        await releaseLock(lockPath, token);
      } catch (caught) {
        lockError = caught;
      }
    }
    if (rollbackError || lockError) {
      throw new UpgradeError(
        `upgrade failed (${error.message}); recovery was incomplete${rollbackError ? `: ${rollbackError.message}` : `: ${lockError.message}`}`,
        'UPGRADE_RECOVERY_FAILED',
        { backupRoot, cause: error, rollbackError, lockError },
      );
    }
    if (error instanceof UpgradeError) {
      error.backupRoot = backupRoot;
      throw error;
    }
    throw new UpgradeError(error.message, error.code ?? 'UPGRADE_FAILED', { backupRoot, cause: error });
  }
}
