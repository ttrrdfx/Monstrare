import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { compareSemVer, parseSemVer, sha256File } from './manifest.mjs';
import { normalizeRelativePath, resolvePathWithinRoot } from './paths.mjs';

export const MIGRATION_CHECK_STATES = Object.freeze([
  'needed',
  'already-applied',
  'incompatible',
]);

const CHECK_STATES = new Set(MIGRATION_CHECK_STATES);
const MIGRATION_ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const BOARD_DATA_PATHS = Object.freeze([
  { kind: 'tree', path: 'tools/kanban/cards' },
  { kind: 'exact', path: 'tools/kanban/epics.json' },
]);

export class MigrationError extends Error {
  constructor(message, code = 'MIGRATION_FAILED', details = {}) {
    super(message);
    this.name = 'MigrationError';
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

function parseAllowedPath(value, label) {
  if (typeof value !== 'string') {
    throw new MigrationError(`${label} must be a string`, 'MIGRATION_REGISTRY_INVALID');
  }
  const kind = value.endsWith('/**') ? 'tree' : 'exact';
  const rawPath = kind === 'tree' ? value.slice(0, -3) : value;
  let safe;
  try {
    safe = normalizeRelativePath(rawPath, label);
  } catch (error) {
    throw new MigrationError(error.message, 'MIGRATION_REGISTRY_INVALID', { cause: error });
  }
  if (safe === '.monstrare' || safe.startsWith('.monstrare/')) {
    throw new MigrationError(
      `${label} must not include transaction metadata: ${value}`,
      'MIGRATION_REGISTRY_INVALID',
    );
  }
  return { kind, path: safe, display: kind === 'tree' ? `${safe}/**` : safe };
}

function scopesOverlap(left, right) {
  if (left.path === right.path) return true;
  if (left.kind === 'tree' && right.path.startsWith(`${left.path}/`)) return true;
  if (right.kind === 'tree' && left.path.startsWith(`${right.path}/`)) return true;
  return false;
}

function scopeContains(scope, relativePath) {
  return scope.kind === 'exact'
    ? scope.path === relativePath
    : relativePath.startsWith(`${scope.path}/`);
}

function touchesBoardData(scopes) {
  return scopes.some((scope) => BOARD_DATA_PATHS.some((boardScope) => scopesOverlap(scope, boardScope)));
}

function normalizeMigration(migration, index) {
  const label = `migration[${index}]`;
  if (!migration || typeof migration !== 'object' || Array.isArray(migration)) {
    throw new MigrationError(`${label} must be an object`, 'MIGRATION_REGISTRY_INVALID');
  }
  if (typeof migration.id !== 'string' || !MIGRATION_ID_RE.test(migration.id)) {
    throw new MigrationError(
      `${label}.id must match ${MIGRATION_ID_RE}`,
      'MIGRATION_REGISTRY_INVALID',
    );
  }
  try {
    parseSemVer(migration.fromVersion, `${label}.fromVersion`);
    parseSemVer(migration.toVersion, `${label}.toVersion`);
  } catch (error) {
    throw new MigrationError(error.message, 'MIGRATION_REGISTRY_INVALID', { cause: error });
  }
  if (compareSemVer(migration.fromVersion, migration.toVersion) >= 0) {
    throw new MigrationError(
      `${label} must move forward without a cycle: ${migration.fromVersion} -> ${migration.toVersion}`,
      'MIGRATION_CYCLE',
    );
  }
  if (!Array.isArray(migration.allowedPaths) || migration.allowedPaths.length === 0) {
    throw new MigrationError(`${label}.allowedPaths must be a non-empty array`, 'MIGRATION_REGISTRY_INVALID');
  }
  const allowedScopes = migration.allowedPaths.map((entry, scopeIndex) => (
    parseAllowedPath(entry, `${label}.allowedPaths[${scopeIndex}]`)
  ));
  for (let left = 0; left < allowedScopes.length; left += 1) {
    for (let right = left + 1; right < allowedScopes.length; right += 1) {
      if (scopesOverlap(allowedScopes[left], allowedScopes[right])) {
        throw new MigrationError(
          `${label}.allowedPaths contains overlapping scopes`,
          'MIGRATION_REGISTRY_INVALID',
        );
      }
    }
  }
  if (typeof migration.check !== 'function' || typeof migration.apply !== 'function') {
    throw new MigrationError(`${label} must define check and apply functions`, 'MIGRATION_REGISTRY_INVALID');
  }
  if (migration.validate !== undefined && typeof migration.validate !== 'function') {
    throw new MigrationError(`${label}.validate must be a function`, 'MIGRATION_REGISTRY_INVALID');
  }
  if (touchesBoardData(allowedScopes) && typeof migration.validate !== 'function') {
    throw new MigrationError(
      `${label} touches cards/epics and must define validate`,
      'MIGRATION_SCHEMA_VALIDATOR_REQUIRED',
    );
  }
  return Object.freeze({ ...migration, allowedScopes: Object.freeze(allowedScopes) });
}

export function validateMigrationRegistry(registry = []) {
  if (!Array.isArray(registry)) {
    throw new MigrationError('migration registry must be an array', 'MIGRATION_REGISTRY_INVALID');
  }
  const normalized = registry.map(normalizeMigration);
  const ids = new Set();
  const transitions = new Set();
  for (const migration of normalized) {
    if (ids.has(migration.id)) {
      throw new MigrationError(`duplicate migration id: ${migration.id}`, 'MIGRATION_DUPLICATE_ID');
    }
    ids.add(migration.id);
    const transition = `${migration.fromVersion}->${migration.toVersion}`;
    if (transitions.has(transition)) {
      throw new MigrationError(`duplicate migration transition: ${transition}`, 'MIGRATION_DUPLICATE_TRANSITION');
    }
    transitions.add(transition);
  }
  return normalized.sort((left, right) => (
    compareSemVer(left.fromVersion, right.fromVersion)
    || compareSemVer(left.toVersion, right.toVersion)
    || compareStrings(left.id, right.id)
  ));
}

export function buildMigrationChain({ fromVersion, toVersion, registry = [] }) {
  try {
    parseSemVer(fromVersion, 'migration start version');
    parseSemVer(toVersion, 'migration target version');
  } catch (error) {
    throw new MigrationError(error.message, 'MIGRATION_VERSION_INVALID', { cause: error });
  }
  if (compareSemVer(fromVersion, toVersion) > 0) {
    throw new MigrationError(
      `migration downgrade is not allowed: ${fromVersion} -> ${toVersion}`,
      'MIGRATION_DOWNGRADE',
    );
  }
  if (fromVersion === toVersion) return [];

  const migrations = validateMigrationRegistry(registry);
  const crossing = migrations.find((migration) => (
    compareSemVer(migration.fromVersion, fromVersion) < 0
      && compareSemVer(migration.toVersion, fromVersion) > 0
  ) || (
    compareSemVer(migration.fromVersion, toVersion) < 0
      && compareSemVer(migration.toVersion, toVersion) > 0
  ));
  if (crossing) {
    throw new MigrationError(
      `migration ${crossing.id} crosses an unknown version boundary`,
      'MIGRATION_UNKNOWN_VERSION',
    );
  }

  const relevant = migrations.filter((migration) => (
    compareSemVer(migration.fromVersion, fromVersion) >= 0
      && compareSemVer(migration.toVersion, toVersion) <= 0
  ));
  if (relevant.length === 0) return [];

  const chain = [];
  const used = new Set();
  let current = fromVersion;
  while (current !== toVersion) {
    const candidates = relevant.filter((migration) => migration.fromVersion === current);
    if (candidates.length === 0) {
      throw new MigrationError(
        `migration chain has a gap after ${current} on the way to ${toVersion}`,
        'MIGRATION_CHAIN_GAP',
      );
    }
    if (candidates.length > 1) {
      throw new MigrationError(
        `migration chain branches at ${current}: ${candidates.map(({ id }) => id).join(', ')}`,
        'MIGRATION_CHAIN_AMBIGUOUS',
      );
    }
    const migration = candidates[0];
    if (used.has(migration.id)) {
      throw new MigrationError(`migration chain contains a cycle at ${migration.id}`, 'MIGRATION_CYCLE');
    }
    used.add(migration.id);
    chain.push(migration);
    current = migration.toVersion;
  }
  if (used.size !== relevant.length) {
    const unused = relevant.filter(({ id }) => !used.has(id)).map(({ id }) => id);
    throw new MigrationError(
      `migration chain contains unreachable entries: ${unused.join(', ')}`,
      'MIGRATION_CHAIN_AMBIGUOUS',
    );
  }
  return chain;
}

function assertAllowed(scopes, relativePath) {
  let safe;
  try {
    safe = normalizeRelativePath(relativePath, 'migration path');
  } catch (error) {
    throw new MigrationError(error.message, 'MIGRATION_SCOPE_VIOLATION', { cause: error });
  }
  if (!scopes.some((scope) => scopeContains(scope, safe))) {
    throw new MigrationError(
      `migration path is outside its allowed scope: ${safe}`,
      'MIGRATION_SCOPE_VIOLATION',
      { path: safe },
    );
  }
  return safe;
}

async function assertNoSymlinks(root, relativePath, { allowMissing = true } = {}) {
  const safe = normalizeRelativePath(relativePath, 'migration path');
  const resolvedRoot = await fs.realpath(root);
  let current = resolvedRoot;
  for (const segment of safe.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new MigrationError(`migration path contains a symlink: ${safe}`, 'MIGRATION_SYMLINK_UNSAFE');
    }
  }
}

async function listScopeFiles(targetRoot, scopes) {
  const files = new Set();
  async function walk(relativeDirectory) {
    await assertNoSymlinks(targetRoot, relativeDirectory, { allowMissing: false });
    const absolute = await resolvePathWithinRoot(targetRoot, relativeDirectory, { mustExist: true });
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new MigrationError(
          `migration scope contains a symlink: ${relativePath}`,
          'MIGRATION_SYMLINK_UNSAFE',
        );
      }
      if (entry.isDirectory()) await walk(relativePath);
      else if (entry.isFile()) files.add(relativePath);
      else {
        throw new MigrationError(
          `migration scope contains an unsupported entry: ${relativePath}`,
          'MIGRATION_PATH_UNSAFE',
        );
      }
    }
  }

  for (const scope of scopes) {
    await assertNoSymlinks(targetRoot, scope.path);
    const absolute = await resolvePathWithinRoot(targetRoot, scope.path);
    if (!await pathExists(absolute)) continue;
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new MigrationError(`migration scope is a symlink: ${scope.path}`, 'MIGRATION_SYMLINK_UNSAFE');
    }
    if (scope.kind === 'exact') {
      if (!stat.isFile()) {
        throw new MigrationError(`migration file scope is not a file: ${scope.path}`, 'MIGRATION_PATH_UNSAFE');
      }
      files.add(scope.path);
    } else {
      if (!stat.isDirectory()) {
        throw new MigrationError(`migration tree scope is not a directory: ${scope.path}`, 'MIGRATION_PATH_UNSAFE');
      }
      await walk(scope.path);
    }
  }
  return [...files].sort(compareStrings);
}

async function ensureSafeParent(targetRoot, relativePath, createdDirectories) {
  const safe = normalizeRelativePath(relativePath, 'migration path');
  const parent = path.posix.dirname(safe);
  if (parent !== '.') {
    const resolvedRoot = await fs.realpath(targetRoot);
    let current = resolvedRoot;
    let logical = '';
    for (const segment of parent.split('/')) {
      logical = logical ? `${logical}/${segment}` : segment;
      current = path.join(current, segment);
      let stat;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.mkdir(current);
        createdDirectories.add(logical);
        stat = await fs.lstat(current);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new MigrationError(`unsafe migration parent: ${logical}`, 'MIGRATION_PATH_UNSAFE');
      }
    }
  }
  await assertNoSymlinks(targetRoot, safe);
  return resolvePathWithinRoot(targetRoot, safe);
}

async function writeFileAtomic(targetRoot, relativePath, contents, createdDirectories) {
  const destination = await ensureSafeParent(targetRoot, relativePath, createdDirectories);
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let mode = 0o644;
  try {
    const stat = await fs.lstat(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new MigrationError(`migration destination is not a regular file: ${relativePath}`, 'MIGRATION_PATH_UNSAFE');
    }
    mode = stat.mode & 0o777;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx', mode });
    await assertNoSymlinks(targetRoot, relativePath);
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function inspectFile(targetRoot, relativePath) {
  await assertNoSymlinks(targetRoot, relativePath);
  const absolute = await resolvePathWithinRoot(targetRoot, relativePath);
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { exists: true, type: stat.isDirectory() ? 'directory' : 'other' };
    }
    return { exists: true, type: 'file', sha256: await sha256File(absolute), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, type: 'missing' };
    throw error;
  }
}

function sameFileState(left, right) {
  return left.exists === right.exists
    && left.type === right.type
    && left.sha256 === right.sha256;
}

function createContext({ targetRoot, migration, readOnly, record }) {
  async function checkedPath(relativePath) {
    const safe = assertAllowed(migration.allowedScopes, relativePath);
    await assertNoSymlinks(targetRoot, safe);
    return safe;
  }
  function assertWritable() {
    if (readOnly) {
      throw new MigrationError('migration check/validate context is read-only', 'MIGRATION_READ_ONLY');
    }
  }
  async function noteTouched(relativePath) {
    const current = await inspectFile(targetRoot, relativePath);
    record.touched.set(relativePath, current);
  }
  return Object.freeze({
    async exists(relativePath) {
      const safe = await checkedPath(relativePath);
      return (await inspectFile(targetRoot, safe)).exists;
    },
    async readText(relativePath) {
      const safe = await checkedPath(relativePath);
      return fs.readFile(await resolvePathWithinRoot(targetRoot, safe, { mustExist: true }), 'utf8');
    },
    async readJson(relativePath) {
      const safe = await checkedPath(relativePath);
      const contents = await fs.readFile(
        await resolvePathWithinRoot(targetRoot, safe, { mustExist: true }),
        'utf8',
      );
      try {
        return JSON.parse(contents);
      } catch (error) {
        throw new MigrationError(`migration JSON is invalid: ${safe}`, 'MIGRATION_DATA_INVALID', { cause: error });
      }
    },
    async listFiles() {
      return listScopeFiles(targetRoot, migration.allowedScopes);
    },
    async writeText(relativePath, contents) {
      assertWritable();
      if (typeof contents !== 'string') {
        throw new MigrationError('migration writeText contents must be a string', 'MIGRATION_DATA_INVALID');
      }
      const safe = await checkedPath(relativePath);
      await writeFileAtomic(targetRoot, safe, contents, record.createdDirectories);
      await noteTouched(safe);
    },
    async writeJson(relativePath, value) {
      assertWritable();
      const safe = await checkedPath(relativePath);
      await writeFileAtomic(
        targetRoot,
        safe,
        `${JSON.stringify(value, null, 2)}\n`,
        record.createdDirectories,
      );
      await noteTouched(safe);
    },
    async removeFile(relativePath) {
      assertWritable();
      const safe = await checkedPath(relativePath);
      const before = await inspectFile(targetRoot, safe);
      if (!before.exists) {
        record.touched.set(safe, before);
        return;
      }
      if (before.type !== 'file') {
        throw new MigrationError(`migration can only remove regular files: ${safe}`, 'MIGRATION_PATH_UNSAFE');
      }
      await fs.unlink(await resolvePathWithinRoot(targetRoot, safe, { mustExist: true }));
      await noteTouched(safe);
    },
  });
}

async function checkMigration(migration, context) {
  const status = await migration.check(context);
  if (!CHECK_STATES.has(status)) {
    throw new MigrationError(
      `migration ${migration.id} returned an invalid check status: ${String(status)}`,
      'MIGRATION_CHECK_INVALID',
    );
  }
  if (status === 'incompatible') {
    throw new MigrationError(
      `migration ${migration.id} found incompatible project data`,
      'MIGRATION_INCOMPATIBLE',
      { migrationId: migration.id },
    );
  }
  return status;
}

export async function prepareMigrations({ targetRoot, fromVersion, toVersion, registry = [] }) {
  const chain = buildMigrationChain({ fromVersion, toVersion, registry });
  const prepared = [];
  let canCheckCurrentState = true;
  for (const migration of chain) {
    let status = 'pending';
    if (canCheckCurrentState) {
      const emptyRecord = { touched: new Map(), createdDirectories: new Set() };
      const context = createContext({ targetRoot, migration, readOnly: true, record: emptyRecord });
      status = await checkMigration(migration, context);
      // A needed step changes the data seen by every later step, so their
      // checks must wait until the transaction has applied their predecessor.
      canCheckCurrentState = status === 'already-applied';
    }
    prepared.push({ migration, status });
  }
  return prepared;
}

async function snapshotMigrationScope({ targetRoot, backupRoot, migration }) {
  const files = await listScopeFiles(targetRoot, migration.allowedScopes);
  const initial = new Map();
  const filesRoot = path.join(backupRoot, 'migrations', migration.id, 'files');
  await fs.mkdir(filesRoot, { recursive: true, mode: 0o700 });
  for (const relativePath of files) {
    const inspected = await inspectFile(targetRoot, relativePath);
    initial.set(relativePath, inspected);
    const destination = path.join(filesRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(
      await resolvePathWithinRoot(targetRoot, relativePath, { mustExist: true }),
      destination,
      fs.constants.COPYFILE_EXCL,
    );
    await fs.chmod(destination, inspected.mode);
    if (await sha256File(destination) !== inspected.sha256) {
      throw new MigrationError(`migration backup checksum changed: ${relativePath}`, 'MIGRATION_BACKUP_FAILED');
    }
  }
  const snapshot = {
    migrationId: migration.id,
    allowedPaths: migration.allowedScopes.map(({ display }) => display),
    files: files.map((relativePath) => ({ path: relativePath, ...initial.get(relativePath) })),
  };
  await fs.writeFile(
    path.join(backupRoot, 'migrations', migration.id, 'snapshot.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return { migration, initial, touched: new Map(), createdDirectories: new Set(), filesRoot };
}

async function assertTrackedScopeChanges(targetRoot, record) {
  const currentPaths = await listScopeFiles(targetRoot, record.migration.allowedScopes);
  const paths = new Set([...record.initial.keys(), ...currentPaths]);
  const untracked = [];
  for (const relativePath of paths) {
    const initial = record.initial.get(relativePath) ?? { exists: false, type: 'missing' };
    const current = await inspectFile(targetRoot, relativePath);
    const expected = record.touched.get(relativePath);
    if (expected && !sameFileState(expected, current)) {
      record.touched.set(relativePath, current);
      untracked.push(relativePath);
    } else if (!sameFileState(initial, current) && !expected) {
      // Record the observed state before rejecting so the shared transaction
      // can still restore a migration that bypassed its write API.
      record.touched.set(relativePath, current);
      untracked.push(relativePath);
    }
  }
  if (untracked.length > 0) {
    throw new MigrationError(
      `migration ${record.migration.id} changed paths outside the transaction API: ${untracked.sort(compareStrings).join(', ')}`,
      'MIGRATION_UNTRACKED_WRITE',
      { paths: untracked },
    );
  }
}

export async function executeMigrations({
  targetRoot,
  backupRoot,
  prepared,
  rollbackRecords,
  onProgress = async () => {},
}) {
  const applied = [];
  for (const item of prepared) {
    const { migration } = item;
    const checkRecord = { touched: new Map(), createdDirectories: new Set() };
    const checkContext = createContext({ targetRoot, migration, readOnly: true, record: checkRecord });
    const status = await checkMigration(migration, checkContext);
    if (status === 'already-applied') {
      await onProgress({ id: migration.id, status, touchedPaths: [] });
      continue;
    }
    const record = await snapshotMigrationScope({ targetRoot, backupRoot, migration });
    rollbackRecords.push(record);
    await onProgress({ id: migration.id, status: 'applying', touchedPaths: [] });
    const context = createContext({ targetRoot, migration, readOnly: false, record });
    await migration.apply(context);
    await assertTrackedScopeChanges(targetRoot, record);
    const readOnlyContext = createContext({ targetRoot, migration, readOnly: true, record });
    const afterStatus = await checkMigration(migration, readOnlyContext);
    if (afterStatus !== 'already-applied') {
      throw new MigrationError(
        `migration ${migration.id} is not idempotent after apply (check returned ${afterStatus})`,
        'MIGRATION_NOT_IDEMPOTENT',
      );
    }
    if (migration.validate) await migration.validate(readOnlyContext);
    const touchedPaths = [...record.touched.keys()].sort(compareStrings);
    applied.push({ id: migration.id, touchedPaths });
    await onProgress({ id: migration.id, status: 'applied', touchedPaths });
  }
  return applied;
}

async function removeCreatedDirectories(targetRoot, directories) {
  const ordered = [...directories].sort((left, right) => (
    right.split('/').length - left.split('/').length || compareStrings(right, left)
  ));
  for (const relativePath of ordered) {
    const absolute = await resolvePathWithinRoot(targetRoot, relativePath);
    await fs.rmdir(absolute).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    });
  }
}

export async function rollbackMigrations({ targetRoot, rollbackRecords }) {
  for (const record of [...rollbackRecords].reverse()) {
    const touchedPaths = [...record.touched.keys()].sort(compareStrings).reverse();
    for (const relativePath of touchedPaths) {
      const expected = record.touched.get(relativePath);
      const current = await inspectFile(targetRoot, relativePath);
      if (!sameFileState(current, expected)) {
        throw new MigrationError(
          `cannot safely roll back changed migration path: ${relativePath}`,
          'MIGRATION_ROLLBACK_CONFLICT',
        );
      }
      const initial = record.initial.get(relativePath);
      if (initial) {
        await writeFileAtomic(
          targetRoot,
          relativePath,
          await fs.readFile(path.join(record.filesRoot, relativePath)),
          new Set(),
        );
        await fs.chmod(await resolvePathWithinRoot(targetRoot, relativePath), initial.mode);
      } else if (current.exists) {
        await fs.unlink(await resolvePathWithinRoot(targetRoot, relativePath, { mustExist: true }));
      }
    }
    await removeCreatedDirectories(targetRoot, record.createdDirectories);
  }
}
