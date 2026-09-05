import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/**
 * Automatically ensures that .agent-monitor/ is added to the project's Git exclusion lists:
 * 1. `.git/info/exclude` (Local Git exclusion — doesn't dirty the working tree or modify tracked files)
 * 2. `.gitignore` (Project Git ignore — ensures collaborators also don't commit it)
 */
export function ensureGitIgnore(workspaceRoot: string): void {
  try {
    const ignorePattern = ".agent-monitor/";

    // 1. Always update local Git exclude if inside a Git repository (.git/info/exclude)
    const gitDir = path.join(workspaceRoot, ".git");
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      const gitExcludePath = path.join(gitDir, "info", "exclude");
      if (fs.existsSync(gitExcludePath)) {
        const excludeContent = fs.readFileSync(gitExcludePath, "utf8");
        if (!excludeContent.includes(".agent-monitor")) {
          const sep = excludeContent.endsWith("\n") || excludeContent.length === 0 ? "" : "\n";
          fs.appendFileSync(
            gitExcludePath,
            `${sep}\n# Agent Monitor local database and logs (auto-managed)\n${ignorePattern}\n`,
            "utf8"
          );
        }
      }
    }

    // 2. Check/update project-level .gitignore
    const gitignorePath = path.join(workspaceRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      if (!gitignoreContent.includes(".agent-monitor")) {
        const sep = gitignoreContent.endsWith("\n") || gitignoreContent.length === 0 ? "" : "\n";
        fs.appendFileSync(
          gitignorePath,
          `${sep}\n# Agent Monitor local database and logs (auto-managed)\n${ignorePattern}\n`,
          "utf8"
        );
      }
    } else if (fs.existsSync(gitDir)) {
      // If it's a Git repo without a .gitignore, create a minimal .gitignore
      fs.writeFileSync(
        gitignorePath,
        `# Agent Monitor local database and logs (auto-managed)\n${ignorePattern}\n`,
        "utf8"
      );
    }
  } catch {
    // Non-fatal: filesystem or permission issues should never break the agent
  }
}

/**
 * Resolves the database storage directory for a workspace.
 * Supports:
 * - Local project directory: `<workspaceRoot>/.agent-monitor` (default, auto-ignored in git)
 * - User home directory: `~/.agent-monitor/workspaces/<hash>` (if AGENT_MONITOR_GLOBAL_STORAGE=true)
 */
export function resolveStorageDir(
  workspaceRoot: string,
  options: { globalStorage?: boolean } = {}
): string {
  const useGlobal =
    options.globalStorage ||
    process.env.AGENT_MONITOR_GLOBAL_STORAGE === "true" ||
    process.env.AGENT_MONITOR_GLOBAL_STORAGE === "1";

  if (useGlobal) {
    const hash = crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const globalDir = path.join(os.homedir(), ".agent-monitor", "workspaces", hash);
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }
    return globalDir;
  }

  const localDir = path.join(workspaceRoot, ".agent-monitor");
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  // Ensure Git never tracks local storage
  ensureGitIgnore(workspaceRoot);

  return localDir;
}

/**
 * Resolves the SQLite database file path.
 */
export function resolveDatabasePath(
  workspaceRoot: string,
  options: { db?: string; globalStorage?: boolean } = {}
): string {
  if (options.db) {
    return path.resolve(options.db);
  }
  const storageDir = resolveStorageDir(workspaceRoot, options);
  return path.join(storageDir, "data.db");
}
