import path from 'node:path';
import fs from 'node:fs';

export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_COMMAND_OUTPUT_BYTES = 100 * 1024; // 100 KB
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Validates and resolves a path to ensure it strictly remains inside the workspace root.
 * Accounts for relative paths, .., absolute paths, symlinks, and files that do not exist yet.
 */
export function resolveSafeWorkspacePath(
  targetPath: string,
  workspaceRoot: string
): { safePath: string; isOutsideWorkspace: boolean; reason?: string } {
  const normalizedRoot = path.resolve(workspaceRoot);

  // Resolve target against workspace root
  let resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(normalizedRoot, targetPath);
  // Iteratively decode URL encodings (e.g. %2e%2e%2f or nested %252e%252e%252f)
  let cleanPath = targetPath;
  try {
    let prev = targetPath;
    for (let i = 0; i < 5; i++) {
      const next = decodeURIComponent(prev);
      if (next === prev) break;
      prev = next;
    }
    cleanPath = prev;
  } catch {}

  // Check containment using path.relative
  const rel = path.relative(normalizedRoot, resolvedTarget);
  const isOutside = rel.startsWith('..') || path.isAbsolute(rel);
  // Check both raw targetPath and URL-decoded candidate
  const candidates = [targetPath];
  if (cleanPath !== targetPath) {
    candidates.push(cleanPath);
  }

  if (isOutside) {
    return {
      safePath: resolvedTarget,
      isOutsideWorkspace: true,
      reason: `Path '${targetPath}' resolves outside workspace root '${normalizedRoot}'`,
    };
  for (const cand of candidates) {
    const resolvedCand = path.isAbsolute(cand)
      ? path.resolve(cand)
      : path.resolve(normalizedRoot, cand);

    const rel = path.relative(normalizedRoot, resolvedCand);
    const isOutside = rel.startsWith('..') || path.isAbsolute(rel);

    if (isOutside) {
      return {
        safePath: resolvedCand,
        isOutsideWorkspace: true,
        reason: `Path '${targetPath}' resolves outside workspace root '${normalizedRoot}'`,
      };
    }
  }

  // Use the decoded candidate for resolvedTarget path
  const resolvedTarget = path.isAbsolute(cleanPath)
    ? path.resolve(cleanPath)
    : path.resolve(normalizedRoot, cleanPath);

  // Check symlinks only if workspaceRoot exists on physical filesystem
  if (fs.existsSync(normalizedRoot)) {
    try {
      let currentCheck = resolvedTarget;
      while (!fs.existsSync(currentCheck) && currentCheck !== path.dirname(currentCheck)) {
        currentCheck = path.dirname(currentCheck);
      }

      if (fs.existsSync(currentCheck)) {
        const realExisting = fs.realpathSync(currentCheck);
        const realRoot = fs.realpathSync(normalizedRoot);
        const relReal = path.relative(realRoot, realExisting);
        if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
          return {
            safePath: resolvedTarget,
            isOutsideWorkspace: true,
            reason: `Symlink target '${realExisting}' points outside workspace root '${realRoot}'`,
          };
        }
      }
    } catch (err: any) {
      return {
        safePath: resolvedTarget,
        isOutsideWorkspace: true,
        reason: `Could not verify real path: ${err.message}`,
      };
    }
  }

  return {
    safePath: resolvedTarget,
    isOutsideWorkspace: false,
  };
}

/**
 * Truncates text output to a safe maximum byte size to prevent memory exhaustion.
 */
export function truncateOutput(output: string, maxBytes: number = MAX_COMMAND_OUTPUT_BYTES): string {
  const buf = Buffer.from(output, 'utf8');
  if (buf.length <= maxBytes) {
    return output;
  }
  const truncated = buf.subarray(0, maxBytes).toString('utf8');
  return `${truncated}\n... [Output truncated: exceeded ${maxBytes / 1024} KB limit]`;
}
