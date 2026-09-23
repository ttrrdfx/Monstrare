import fs from 'node:fs/promises';
import path from 'node:path';

import {
  classifyInventoryPath,
  expandSourceInventory,
  parseSemVer,
  readSourceManifest,
  sha256,
  validateSourceManifest,
} from './manifest.mjs';
import { normalizeRelativePath, resolveSafeRoot } from './paths.mjs';

export const RELEASE_BUNDLE_SCHEMA_VERSION = 1;
export const RELEASE_BUNDLE_LIMITS = Object.freeze({
  maxBundleBytes: 32 * 1024 * 1024,
  maxFiles: 5000,
  maxFileBytes: 64 * 1024 * 1024,
  maxDecodedBytes: 64 * 1024 * 1024,
});

const BUNDLE_KEYS = new Set(['schemaVersion', 'version', 'createdFrom', 'files']);
const FILE_KEYS = new Set(['path', 'ownership', 'mode', 'sha256', 'contentBase64']);
const BUNDLE_OWNERSHIP = new Set(['managed', 'seed-only']);
const BUNDLE_MODES = new Set([0o644, 0o755]);
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_SHA_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class ReleaseBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseBundleError';
    this.code = 'RELEASE_BUNDLE_INVALID';
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReleaseBundleError(`${label} must be an object`);
  }
}

function assertOnlyKeys(value, allowed, label) {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) throw new ReleaseBundleError(`${label} contains unsupported field: ${unsupported}`);
}

function resolveLimits(overrides = {}) {
  assertPlainObject(overrides, 'release bundle limits');
  assertOnlyKeys(overrides, new Set(Object.keys(RELEASE_BUNDLE_LIMITS)), 'release bundle limits');
  const resolved = { ...RELEASE_BUNDLE_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Number.isSafeInteger(value) || value < 0 || value > RELEASE_BUNDLE_LIMITS[key]) {
      throw new ReleaseBundleError(`${key} must be an integer no greater than the hard release bundle limit`);
    }
    resolved[key] = value;
  }
  return resolved;
}

function inspectBase64(value, label) {
  if (typeof value !== 'string' || !BASE64_RE.test(value)) {
    throw new ReleaseBundleError(`${label} must be canonical base64`);
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function decodeBase64(value, label) {
  inspectBase64(value, label);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new ReleaseBundleError(`${label} must be canonical base64`);
  }
  return decoded;
}

function decodeUtf8(content, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new ReleaseBundleError(`${label} must contain valid UTF-8`);
  }
}

function canonicalJson(normalized) {
  return `${JSON.stringify(normalized)}\n`;
}

function freezeBundle(bundle) {
  for (const file of bundle.files) Object.freeze(file);
  Object.freeze(bundle.files);
  return Object.freeze(bundle);
}

function validateEmbeddedContract(bundle, decodedByPath) {
  const versionContent = decodedByPath.get('VERSION');
  const manifestContent = decodedByPath.get('monstrare-package.json');
  if (!versionContent || !manifestContent) {
    throw new ReleaseBundleError('release bundle must include VERSION and monstrare-package.json');
  }
  if (decodeUtf8(versionContent, 'VERSION').trim() !== bundle.version) {
    throw new ReleaseBundleError('VERSION does not match release bundle version');
  }

  let manifest;
  try {
    manifest = JSON.parse(decodeUtf8(manifestContent, 'monstrare-package.json'));
  } catch {
    throw new ReleaseBundleError('embedded source manifest contains malformed JSON');
  }
  try {
    manifest = validateSourceManifest(manifest);
  } catch (error) {
    throw new ReleaseBundleError(`embedded source manifest is invalid: ${error.message}`);
  }
  if (manifest.version !== bundle.version) {
    throw new ReleaseBundleError('source manifest does not match release bundle version');
  }
  for (const file of bundle.files) {
    let ownership;
    try {
      ownership = classifyInventoryPath(file.path, manifest);
    } catch (error) {
      throw new ReleaseBundleError(`embedded source manifest cannot classify ${file.path}: ${error.message}`);
    }
    if (ownership !== file.ownership) {
      throw new ReleaseBundleError(`embedded source manifest ownership mismatch for ${file.path}`);
    }
  }
}

export function validateReleaseBundle(bundle, { expectedVersion, limits } = {}) {
  const effectiveLimits = resolveLimits(limits);
  assertPlainObject(bundle, 'release bundle');
  assertOnlyKeys(bundle, BUNDLE_KEYS, 'release bundle');
  if (bundle.schemaVersion !== RELEASE_BUNDLE_SCHEMA_VERSION) {
    throw new ReleaseBundleError(`unsupported release bundle schema: ${bundle.schemaVersion}`);
  }
  try {
    parseSemVer(bundle.version, 'release bundle version');
    if (expectedVersion !== undefined) parseSemVer(expectedVersion, 'expected release version');
  } catch (error) {
    throw new ReleaseBundleError(error.message);
  }
  if (expectedVersion !== undefined && bundle.version !== expectedVersion) {
    throw new ReleaseBundleError(`release bundle version does not match expected version: ${expectedVersion}`);
  }
  if (typeof bundle.createdFrom !== 'string' || !COMMIT_SHA_RE.test(bundle.createdFrom)) {
    throw new ReleaseBundleError('createdFrom must be a full lowercase Git commit SHA');
  }
  if (!Array.isArray(bundle.files)) throw new ReleaseBundleError('files must be an array');
  if (bundle.files.length > effectiveLimits.maxFiles) {
    throw new ReleaseBundleError(`release bundle exceeds ${effectiveLimits.maxFiles} files`);
  }

  const seen = new Set();
  const decodedByPath = new Map();
  const files = [];
  let decodedBytes = 0;
  for (let index = 0; index < bundle.files.length; index += 1) {
    const record = bundle.files[index];
    const label = `files[${index}]`;
    assertPlainObject(record, label);
    assertOnlyKeys(record, FILE_KEYS, label);

    let safePath;
    try {
      safePath = normalizeRelativePath(record.path, `${label}.path`);
    } catch (error) {
      throw new ReleaseBundleError(error.message);
    }
    if (seen.has(safePath)) throw new ReleaseBundleError(`duplicate release bundle path: ${safePath}`);
    seen.add(safePath);
    if (!BUNDLE_OWNERSHIP.has(record.ownership)) {
      throw new ReleaseBundleError(`invalid ownership for ${safePath}: ${record.ownership}`);
    }
    if (!Number.isInteger(record.mode) || !BUNDLE_MODES.has(record.mode)) {
      throw new ReleaseBundleError(`invalid mode for ${safePath}`);
    }
    if (typeof record.sha256 !== 'string' || !SHA256_RE.test(record.sha256)) {
      throw new ReleaseBundleError(`invalid sha256 for ${safePath}`);
    }

    const contentBytes = inspectBase64(record.contentBase64, `contentBase64 for ${safePath}`);
    if (contentBytes > effectiveLimits.maxFileBytes) {
      throw new ReleaseBundleError(`decoded file exceeds size limit: ${safePath}`);
    }
    decodedBytes += contentBytes;
    if (decodedBytes > effectiveLimits.maxDecodedBytes) {
      throw new ReleaseBundleError('release bundle decoded content exceeds total size limit');
    }
    const content = decodeBase64(record.contentBase64, `contentBase64 for ${safePath}`);
    if (sha256(content) !== record.sha256) {
      throw new ReleaseBundleError(`sha256 mismatch for ${safePath}`);
    }
    decodedByPath.set(safePath, content);
    files.push({
      path: safePath,
      ownership: record.ownership,
      mode: record.mode,
      sha256: record.sha256,
      contentBase64: record.contentBase64,
    });
  }

  files.sort((left, right) => compareStrings(left.path, right.path));
  const normalized = {
    schemaVersion: RELEASE_BUNDLE_SCHEMA_VERSION,
    version: bundle.version,
    createdFrom: bundle.createdFrom,
    files,
  };
  validateEmbeddedContract(normalized, decodedByPath);
  if (Buffer.byteLength(canonicalJson(normalized)) > effectiveLimits.maxBundleBytes) {
    throw new ReleaseBundleError(`release bundle exceeds ${effectiveLimits.maxBundleBytes} bytes`);
  }
  return freezeBundle(normalized);
}

export function parseReleaseBundle(input, options = {}) {
  const effectiveLimits = resolveLimits(options.limits);
  if (typeof input !== 'string' && !Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new ReleaseBundleError('release bundle input must be UTF-8 JSON bytes or text');
  }
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  if (bytes.byteLength > effectiveLimits.maxBundleBytes) {
    throw new ReleaseBundleError(`release bundle exceeds ${effectiveLimits.maxBundleBytes} bytes`);
  }

  let parsed;
  try {
    parsed = JSON.parse(decodeUtf8(bytes, 'release bundle'));
  } catch (error) {
    if (error instanceof ReleaseBundleError) throw error;
    throw new ReleaseBundleError('malformed release bundle JSON');
  }
  return validateReleaseBundle(parsed, { ...options, limits: effectiveLimits });
}

export function serializeReleaseBundle(bundle, options = {}) {
  return canonicalJson(validateReleaseBundle(bundle, options));
}

async function readOrdinarySourceFile(sourceRoot, relativePath) {
  const safePath = normalizeRelativePath(relativePath, 'release source path');
  let current = sourceRoot;
  const segments = safePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) {
      throw new ReleaseBundleError(`release source must not contain symlinks: ${safePath}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new ReleaseBundleError(`release source parent is not a directory: ${safePath}`);
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new ReleaseBundleError(`release source entry is not a regular file: ${safePath}`);
    }
  }
  return { content: await fs.readFile(current), mode: (await fs.stat(current)).mode & 0o777 };
}

export async function buildReleaseBundle({ sourceRoot, createdFrom } = {}) {
  if (typeof sourceRoot !== 'string' || sourceRoot.trim() === '') {
    throw new ReleaseBundleError('sourceRoot must be an explicit directory path');
  }
  if (typeof createdFrom !== 'string' || !COMMIT_SHA_RE.test(createdFrom)) {
    throw new ReleaseBundleError('createdFrom must be a full lowercase Git commit SHA');
  }

  const resolvedSource = await fs.realpath(sourceRoot);
  let sourceManifest;
  try {
    sourceManifest = await readSourceManifest(path.join(resolvedSource, 'monstrare-package.json'));
  } catch {
    throw new ReleaseBundleError('release source manifest is invalid');
  }
  const inventory = await expandSourceInventory(resolvedSource, sourceManifest);
  const files = [];
  for (const entry of inventory) {
    if (!BUNDLE_OWNERSHIP.has(entry.ownership)) continue;
    let content;
    let mode;
    try {
      ({ content, mode } = await readOrdinarySourceFile(resolvedSource, entry.path));
    } catch (error) {
      if (error instanceof ReleaseBundleError) throw error;
      throw new ReleaseBundleError(`unable to read release source file: ${entry.path}`);
    }
    if (!BUNDLE_MODES.has(mode)) {
      throw new ReleaseBundleError(`release source has unsupported mode for ${entry.path}`);
    }
    const contentSha256 = sha256(content);
    if (contentSha256 !== entry.sha256) {
      throw new ReleaseBundleError(`release source changed while packaging: ${entry.path}`);
    }
    files.push({
      path: entry.path,
      ownership: entry.ownership,
      mode,
      sha256: contentSha256,
      contentBase64: content.toString('base64'),
    });
  }
  return validateReleaseBundle({
    schemaVersion: RELEASE_BUNDLE_SCHEMA_VERSION,
    version: sourceManifest.version,
    createdFrom,
    files,
  });
}

async function ensureMaterializeDirectory(root, relativeDirectory, createdDirectories) {
  if (relativeDirectory === '.') return;
  let current = root;
  let logical = '';
  for (const segment of relativeDirectory.split('/')) {
    logical = logical ? `${logical}/${segment}` : segment;
    current = path.join(current, segment);
    try {
      await fs.mkdir(current, { mode: 0o755 });
      createdDirectories.add(logical);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new ReleaseBundleError(`materialize parent is not a regular directory: ${logical}`);
      }
    }
  }
}

async function cleanMaterializeFailure(root, writtenFiles, createdDirectories) {
  for (const file of [...writtenFiles].reverse()) {
    try {
      const absolute = path.join(root, ...file.path.split('/'));
      const stat = await fs.lstat(absolute);
      if (stat.isFile() && !stat.isSymbolicLink() && sha256(await fs.readFile(absolute)) === file.sha256) {
        await fs.unlink(absolute);
      }
    } catch {
      // Best effort only; never delete a path whose current contents cannot be verified.
    }
  }
  for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
    await fs.rmdir(path.join(root, ...directory.split('/'))).catch(() => {});
  }
}

export async function materializeReleaseBundle({ bundle, targetRoot, expectedVersion, limits } = {}) {
  const normalized = typeof bundle === 'string' || Buffer.isBuffer(bundle) || bundle instanceof Uint8Array
    ? parseReleaseBundle(bundle, { expectedVersion, limits })
    : validateReleaseBundle(bundle, { expectedVersion, limits });
  const resolvedTarget = await resolveSafeRoot(targetRoot);
  if ((await fs.readdir(resolvedTarget)).length !== 0) {
    throw new ReleaseBundleError('materialize target root must be empty');
  }

  const writtenFiles = [];
  const createdDirectories = new Set();
  let activePath = null;
  try {
    for (const file of normalized.files) {
      activePath = file.path;
      const directory = path.posix.dirname(file.path);
      await ensureMaterializeDirectory(resolvedTarget, directory, createdDirectories);
      const destination = path.join(resolvedTarget, ...file.path.split('/'));
      const content = Buffer.from(file.contentBase64, 'base64');
      await fs.writeFile(destination, content, { flag: 'wx', mode: file.mode });
      writtenFiles.push({ path: file.path, sha256: file.sha256 });
      await fs.chmod(destination, file.mode);
      const stat = await fs.lstat(destination);
      if (!stat.isFile() || stat.isSymbolicLink() || sha256(await fs.readFile(destination)) !== file.sha256) {
        throw new ReleaseBundleError(`materialized file verification failed: ${file.path}`);
      }
    }
  } catch (error) {
    await cleanMaterializeFailure(resolvedTarget, writtenFiles, createdDirectories);
    if (error instanceof ReleaseBundleError) throw error;
    throw new ReleaseBundleError(`unable to materialize release bundle file: ${activePath ?? 'unknown'}`);
  }
  return { sourceRoot: resolvedTarget, bundle: normalized };
}
