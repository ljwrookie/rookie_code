import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeForPrefixCheck(p: string): string {
  // Ensure a stable prefix check (avoid "/foo/bar2" matching "/foo/bar")
  const normalized = path.resolve(p);
  return normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
}

function isSubpath(childPath: string, parentPath: string): boolean {
  const parentPrefix = normalizeForPrefixCheck(parentPath);
  const childNormalized = path.resolve(childPath);
  return childNormalized === path.resolve(parentPath) || childNormalized.startsWith(parentPrefix);
}

async function realpathIfExists(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

async function findExistingParentRealpath(absPath: string, workDirReal: string): Promise<string> {
  // Walk up until we find an existing directory we can realpath.
  // This prevents symlink escapes like: workdir/sub -> /etc and writing to sub/file.
  let current = path.resolve(absPath);
  for (let i = 0; i < 64; i++) {
    const rp = await realpathIfExists(current);
    if (rp) return rp;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // As a last resort, fall back to the working dir realpath so caller can fail the subpath check.
  return workDirReal;
}

/**
 * Resolve a user-provided path for reading. The target must exist.
 * Uses realpath to prevent symlink traversal outside working directory.
 */
export async function resolvePathForRead(workingDir: string, filePath: string): Promise<string> {
  const workDirAbs = path.resolve(workingDir);
  const workDirReal = await fs.realpath(workingDir);
  const abs = path.resolve(workingDir, filePath);

  // First do a purely lexical boundary check so path traversal is rejected even if the target does not exist.
  // Use the non-realpath working dir here to avoid false negatives on macOS (/var vs /private/var).
  if (!isSubpath(abs, workDirAbs)) {
    throw new Error(`Path "${filePath}" resolves outside the working directory. Access denied.`);
  }

  const resolved = await fs.realpath(abs);
  if (!isSubpath(resolved, workDirReal)) {
    throw new Error(`Path "${filePath}" resolves outside the working directory. Access denied.`);
  }
  return resolved;
}

/**
 * Resolve a user-provided path for writing/creating. The target may not exist.
 * Verifies the nearest existing parent directory (realpath) stays within working directory.
 */
export async function resolvePathForWrite(workingDir: string, filePath: string): Promise<string> {
  const workDirAbs = path.resolve(workingDir);
  const workDirReal = await fs.realpath(workingDir);
  const abs = path.resolve(workingDir, filePath);

  // Lexical traversal check first (see resolvePathForRead for rationale).
  if (!isSubpath(abs, workDirAbs)) {
    throw new Error(`Path "${filePath}" resolves outside the working directory. Access denied.`);
  }

  const parentAbs = path.dirname(abs);
  const parentReal = await findExistingParentRealpath(parentAbs, workDirReal);

  if (!isSubpath(parentReal, workDirReal)) {
    throw new Error(`Path "${filePath}" resolves outside the working directory. Access denied.`);
  }
  return abs;
}
