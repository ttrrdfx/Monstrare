import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class PathSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathSafetyError';
    this.code = 'PATH_SAFETY';
  }
}

function isWindowsAbsolute(value) {
  return /^[A-Za-z]:/.test(value) || /^\\\\/.test(value);
}

export function normalizeRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PathSafetyError(`${label} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new PathSafetyError(`${label} must not contain a null byte`);
  }
  if (value.includes('\\')) {
    throw new PathSafetyError(`${label} must use forward slashes`);
  }
  if (path.posix.isAbsolute(value) || isWindowsAbsolute(value)) {
    throw new PathSafetyError(`${label} must be relative: ${value}`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new PathSafetyError(`${label} must be normalized and must not contain traversal: ${value}`);
  }

  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
    throw new PathSafetyError(`${label} must be normalized: ${value}`);
  }
  return normalized;
}

export function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function resolveSafeRoot(root, { sourceRoot } = {}) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new PathSafetyError('target root must be an explicit directory path');
  }

  let resolved;
  try {
    resolved = await fs.realpath(root);
  } catch (error) {
    throw new PathSafetyError(`target root does not exist: ${root}`);
  }

  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new PathSafetyError(`target root is not a directory: ${root}`);
  }

  const filesystemRoot = path.parse(resolved).root;
  const home = await fs.realpath(os.homedir());
  if (resolved === filesystemRoot || resolved === home) {
    throw new PathSafetyError(`refusing broad target root: ${resolved}`);
  }
  if (sourceRoot) {
    const resolvedSource = await fs.realpath(sourceRoot);
    if (resolved === resolvedSource) {
      throw new PathSafetyError('target root must not be the Monstrare source root');
    }
  }
  return resolved;
}

export async function resolvePathWithinRoot(root, relativePath, { mustExist = false } = {}) {
  const safeRelative = normalizeRelativePath(relativePath);
  const resolvedRoot = await fs.realpath(root);
  let current = resolvedRoot;

  for (const segment of safeRelative.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (mustExist) {
          throw new PathSafetyError(`path does not exist: ${safeRelative}`);
        }
        continue;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      const real = await fs.realpath(current);
      if (!isPathWithin(resolvedRoot, real)) {
        throw new PathSafetyError(`symlink escapes root: ${safeRelative}`);
      }
      current = real;
    }
  }

  const absolute = path.resolve(current);
  if (!isPathWithin(resolvedRoot, absolute)) {
    throw new PathSafetyError(`path escapes root: ${safeRelative}`);
  }
  return absolute;
}
