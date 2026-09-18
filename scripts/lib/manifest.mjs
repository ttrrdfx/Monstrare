import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRelativePath, resolvePathWithinRoot } from './paths.mjs';

export const SOURCE_SCHEMA_VERSION = 1;
export const INSTALL_SCHEMA_VERSION = 1;
export const OWNERSHIP_TYPES = Object.freeze(['managed', 'seed-only', 'project-data', 'source-only']);

const SOURCE_KEYS = Object.freeze({
  managed: 'managed',
  seedOnly: 'seed-only',
  projectData: 'project-data',
  sourceOnly: 'source-only',
});
const SOURCE_TOP_LEVEL_KEYS = new Set(['schemaVersion', 'version', 'minimumNode', ...Object.keys(SOURCE_KEYS)]);
const INSTALL_TOP_LEVEL_KEYS = new Set(['schemaVersion', 'installedVersion', 'installedAt', 'files']);
const INSTALL_OWNERSHIP_TYPES = new Set(['managed', 'seed-only']);
const SHA256_RE = /^[a-f0-9]{64}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
    this.code = 'MANIFEST_INVALID';
  }
}

export function parseSemVer(value, label = 'version') {
  if (typeof value !== 'string') {
    throw new ManifestError(`${label} must be a strict major.minor.patch version`);
  }
  const match = SEMVER_RE.exec(value);
  if (!match) {
    throw new ManifestError(`${label} must be a strict major.minor.patch version: ${value}`);
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new ManifestError(`${label} contains a numeric component that is too large: ${value}`);
  }
  return { major: parts[0], minor: parts[1], patch: parts[2], version: value };
}

export function compareSemVer(left, right) {
  const a = parseSemVer(left, 'left version');
  const b = parseSemVer(right, 'right version');
  return Math.sign(a.major - b.major || a.minor - b.minor || a.patch - b.patch);
}

export function assertUpgradeAllowed(installedVersion, sourceVersion) {
  if (compareSemVer(sourceVersion, installedVersion) < 0) {
    throw new ManifestError(`downgrade is not allowed: ${installedVersion} -> ${sourceVersion}`);
  }
}

export function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function sha256File(filePath) {
  return sha256(await fs.readFile(filePath));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManifestError(`${label} must be an object`);
  }
}

function normalizePattern(pattern, label) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.includes('\0') || pattern.includes('\\')) {
    throw new ManifestError(`${label} contains an invalid pattern`);
  }
  if (path.posix.isAbsolute(pattern) || /^[A-Za-z]:/.test(pattern)) {
    throw new ManifestError(`${label} pattern must be relative: ${pattern}`);
  }
  const segments = pattern.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ManifestError(`${label} pattern must be normalized: ${pattern}`);
  }
  return pattern;
}

export function validateSourceManifest(manifest) {
  assertPlainObject(manifest, 'source manifest');
  const unsupportedKey = Object.keys(manifest).find((key) => !SOURCE_TOP_LEVEL_KEYS.has(key));
  if (unsupportedKey) throw new ManifestError(`source manifest contains unsupported field: ${unsupportedKey}`);
  if (manifest.schemaVersion !== SOURCE_SCHEMA_VERSION) {
    throw new ManifestError(`unsupported source manifest schema: ${manifest.schemaVersion}`);
  }
  parseSemVer(manifest.version, 'source version');
  parseSemVer(manifest.minimumNode, 'minimumNode');

  const seenPatterns = new Map();
  const normalized = {
    schemaVersion: SOURCE_SCHEMA_VERSION,
    version: manifest.version,
    minimumNode: manifest.minimumNode,
  };

  for (const [key, ownership] of Object.entries(SOURCE_KEYS)) {
    const patterns = manifest[key];
    if (!Array.isArray(patterns)) {
      throw new ManifestError(`${key} must be an array`);
    }
    normalized[key] = patterns.map((pattern) => normalizePattern(pattern, key));
    for (const pattern of normalized[key]) {
      const previous = seenPatterns.get(pattern);
      if (previous && previous !== ownership) {
        throw new ManifestError(`ownership pattern overlaps ${previous} and ${ownership}: ${pattern}`);
      }
      seenPatterns.set(pattern, ownership);
    }
  }
  return normalized;
}

export async function readJsonFile(filePath, label = 'JSON') {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new ManifestError(`unable to read ${label}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ManifestError(`malformed ${label}: ${error.message}`);
  }
}

export async function readSourceManifest(filePath) {
  return validateSourceManifest(await readJsonFile(filePath, 'source manifest'));
}

function globToRegExp(pattern) {
  let result = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          result += '(?:.*/)?';
        } else {
          result += '.*';
        }
      } else {
        result += '[^/]*';
      }
    } else if (char === '?') {
      result += '[^/]';
    } else {
      result += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${result}$`);
}

export function classifyInventoryPath(relativePath, sourceManifest) {
  const safePath = normalizeRelativePath(relativePath, 'inventory path');
  const manifest = validateSourceManifest(sourceManifest);
  const ownerships = [];
  for (const [key, ownership] of Object.entries(SOURCE_KEYS)) {
    if (manifest[key].some((pattern) => globToRegExp(pattern).test(safePath))) ownerships.push(ownership);
  }
  if (ownerships.length > 1) {
    throw new ManifestError(`path has overlapping ownership (${ownerships.join(', ')}): ${safePath}`);
  }
  return ownerships[0] ?? null;
}

async function walkFiles(root, logicalDirectory = '', ancestorRealDirectories = new Set()) {
  const absoluteDirectory = logicalDirectory ? path.join(root, ...logicalDirectory.split('/')) : root;
  const realDirectory = await fs.realpath(absoluteDirectory);
  if (ancestorRealDirectories.has(realDirectory)) {
    throw new ManifestError(`symlink directory cycle detected: ${logicalDirectory || '.'}`);
  }
  const nextAncestors = new Set(ancestorRealDirectories).add(realDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => compareStrings(a.name, b.name))) {
    if (!logicalDirectory && entry.name === '.git') continue;
    const relative = logicalDirectory ? `${logicalDirectory}/${entry.name}` : entry.name;
    const absolute = await resolvePathWithinRoot(root, relative, { mustExist: true });
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      files.push(...await walkFiles(root, relative, nextAncestors));
    } else if (stat.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

export async function expandSourceInventory(sourceRoot, sourceManifest) {
  const manifest = validateSourceManifest(sourceManifest);
  const files = await walkFiles(await fs.realpath(sourceRoot));
  const inventory = [];

  for (const relativePath of files) {
    const ownership = classifyInventoryPath(relativePath, manifest);
    if (ownership) {
      const absolute = await resolvePathWithinRoot(sourceRoot, relativePath, { mustExist: true });
      inventory.push({ path: normalizeRelativePath(relativePath), ownership, sha256: await sha256File(absolute) });
    }
  }

  return inventory.sort((a, b) => compareStrings(a.path, b.path));
}

export function validateInstallManifest(manifest) {
  assertPlainObject(manifest, 'install manifest');
  const unsupportedKey = Object.keys(manifest).find((key) => !INSTALL_TOP_LEVEL_KEYS.has(key));
  if (unsupportedKey) throw new ManifestError(`install manifest contains unsupported field: ${unsupportedKey}`);
  if (manifest.schemaVersion !== INSTALL_SCHEMA_VERSION) {
    throw new ManifestError(`unsupported install manifest schema: ${manifest.schemaVersion}`);
  }
  parseSemVer(manifest.installedVersion, 'installedVersion');
  const installedDate = typeof manifest.installedAt === 'string' ? new Date(manifest.installedAt) : null;
  if (!installedDate || !Number.isFinite(installedDate.getTime()) || installedDate.toISOString() !== manifest.installedAt) {
    throw new ManifestError('installedAt must be an ISO date string');
  }
  assertPlainObject(manifest.files, 'files');

  const files = {};
  for (const relativePath of Object.keys(manifest.files).sort(compareStrings)) {
    const safePath = normalizeRelativePath(relativePath, 'manifest file path');
    const record = manifest.files[relativePath];
    assertPlainObject(record, `file record for ${safePath}`);
    if (!INSTALL_OWNERSHIP_TYPES.has(record.ownership)) {
      throw new ManifestError(`unknown ownership for ${safePath}: ${record.ownership}`);
    }
    if (typeof record.sha256 !== 'string' || !SHA256_RE.test(record.sha256)) {
      throw new ManifestError(`invalid sha256 for ${safePath}`);
    }
    if (Object.keys(record).some((key) => !['ownership', 'sha256'].includes(key))) {
      throw new ManifestError(`file record contains unsupported data: ${safePath}`);
    }
    files[safePath] = { ownership: record.ownership, sha256: record.sha256 };
  }
  return {
    schemaVersion: INSTALL_SCHEMA_VERSION,
    installedVersion: manifest.installedVersion,
    installedAt: installedDate.toISOString(),
    files,
  };
}

export function createInstallManifest({ installedVersion, installedAt = new Date().toISOString(), files }) {
  let records = files;
  if (Array.isArray(files)) {
    records = {};
    for (const file of files) {
      if (Object.hasOwn(records, file.path)) throw new ManifestError(`duplicate install manifest path: ${file.path}`);
      records[file.path] = { ownership: file.ownership, sha256: file.sha256 };
    }
  }
  return validateInstallManifest({
    schemaVersion: INSTALL_SCHEMA_VERSION,
    installedVersion,
    installedAt,
    files: records,
  });
}

export async function readInstallManifest(filePath, { sourceVersion } = {}) {
  const manifest = validateInstallManifest(await readJsonFile(filePath, 'install manifest'));
  if (sourceVersion) assertUpgradeAllowed(manifest.installedVersion, sourceVersion);
  return manifest;
}

export function serializeInstallManifest(manifest) {
  return `${JSON.stringify(validateInstallManifest(manifest), null, 2)}\n`;
}

export async function writeInstallManifestAtomic(filePath, manifest) {
  const serialized = serializeInstallManifest(manifest);
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
