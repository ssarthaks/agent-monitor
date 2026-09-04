import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";
import { validatePolicy, MAX_POLICY_BYTES } from "@agent-monitor/core";

export interface PolicyCliOptions {
  workspace?: string;
  db?: string;
  port?: number;
  json?: boolean;
}

function getRepo(options: PolicyCliOptions): {
  repo: SessionRepository;
  close: () => void;
} {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found at: ${dbPath}`);
  }

  const db = createDatabase(dbPath);
  const repo = new SessionRepository(db);
  return { repo, close: () => db.close() };
}

export async function runPolicyVersionsCommand(
  options: PolicyCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const versions = repo.listPolicyVersions();

    if (options.json) {
      console.log(JSON.stringify({ versions }, null, 2));
      return;
    }

    console.log(pc.bold("\nAGENT MONITOR — Policy Versions\n"));
    if (versions.length === 0) {
      console.log(pc.dim("  No policy versions found in database.\n"));
      return;
    }

    for (const v of versions) {
      const activeMarker = v.isActive ? pc.green(" [ACTIVE]") : "";
      console.log(
        `  ${pc.cyan(v.id)} (v${v.versionNumber}) - ${pc.bold(v.description || v.name || "No description")}${activeMarker}`,
      );
      console.log(
        `    Created By: ${v.createdBy} | Rules: ${v.rules.length} | Hash: ${v.hash.substring(0, 12)} | Created: ${new Date(v.createdAt).toISOString()}`,
      );
      console.log();
    }
  } finally {
    close();
  }
}

export async function runPolicyRollbackCommand(
  targetVersion: string | number,
  options: PolicyCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const vNum = parseInt(String(targetVersion).replace(/^v/, ""), 10);
    if (isNaN(vNum)) {
      throw new Error(
        `Invalid version number for rollback: '${targetVersion}'`,
      );
    }

    const newVersion = repo.rollbackPolicyVersion(vNum, "operator-cli");

    if (options.json) {
      console.log(
        JSON.stringify(
          { success: true, activatedVersion: newVersion },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      pc.green(
        `\n✓ Successfully rolled back to policy version ${pc.bold(String(targetVersion))}`,
      ),
    );
    console.log(
      `  New active version created: ${pc.cyan(newVersion.id)} (v${newVersion.versionNumber})\n`,
    );
  } finally {
    close();
  }
}

export async function runPolicyToggleRuleCommand(
  ruleId: string,
  enabled: boolean,
  options: PolicyCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const newVersion = repo.togglePolicyRule(ruleId, enabled, "operator-cli");

    if (options.json) {
      console.log(
        JSON.stringify(
          { success: true, ruleId, enabled, version: newVersion },
          null,
          2,
        ),
      );
      return;
    }

    const stateStr = enabled ? pc.green("ENABLED") : pc.yellow("DISABLED");
    console.log(`\n✓ Policy rule '${pc.bold(ruleId)}' is now ${stateStr}`);
    console.log(
      `  Updated policy version: ${pc.cyan(newVersion.id)} (v${newVersion.versionNumber})\n`,
    );
  } finally {
    close();
  }
}

export async function runPolicyDiffCommand(
  versionA: string | number,
  versionB: string | number,
  options: PolicyCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const vANum = parseInt(String(versionA).replace(/^v/, ""), 10);
    const vBNum = parseInt(String(versionB).replace(/^v/, ""), 10);

    if (isNaN(vANum) || isNaN(vBNum)) {
      throw new Error(
        `Invalid version numbers for diff: '${versionA}', '${versionB}'`,
      );
    }

    const diff = repo.diffPolicyVersions(vANum, vBNum);

    if (options.json) {
      console.log(JSON.stringify({ diff }, null, 2));
      return;
    }

    console.log(
      pc.bold(`\nAGENT MONITOR — Policy Diff (v${vANum} -> v${vBNum})\n`),
    );
    console.log(`  Rules Added (${diff.addedRules.length}):`);
    for (const r of diff.addedRules) {
      console.log(
        pc.green(
          `    + [${r.id}] ${r.action || "*"} -> ${r.decision || "ALLOW"}`,
        ),
      );
    }
    console.log(`  Rules Removed (${diff.removedRules.length}):`);
    for (const r of diff.removedRules) {
      console.log(
        pc.red(
          `    - [${r.id}] ${r.action || "*"} -> ${r.decision || "ALLOW"}`,
        ),
      );
    }
    console.log(`  Rules Modified (${diff.modifiedRules.length}):`);
    for (const m of diff.modifiedRules) {
      console.log(pc.yellow(`    ~ [${m.ruleId}]`));
      for (const c of m.changes) {
        console.log(`        ${c}`);
      }
    }
    console.log();
  } finally {
    close();
  }
}

export async function runPolicyHistoryCommand(
  options: PolicyCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const history = repo.getPolicyAuditLog(50);

    if (options.json) {
      console.log(JSON.stringify({ history }, null, 2));
      return;
    }

    console.log(pc.bold("\nAGENT MONITOR — Policy Mutation Audit History\n"));
    if (history.length === 0) {
      console.log(pc.dim("  No policy mutation records found.\n"));
      return;
    }

    for (const item of history) {
      console.log(
        `  ${new Date(item.timestamp).toISOString()} [${pc.cyan(item.action)}] by ${pc.bold(item.actor)}`,
      );
      if (item.details?.reason)
        console.log(`    Reason: ${item.details.reason}`);
      if (item.details?.ruleId)
        console.log(`    Rule ID: ${item.details.ruleId}`);
      console.log();
    }
  } finally {
    close();
  }
}

export async function runPolicyValidateCommand(
  filePath: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    if (options.json) {
      console.log(
        JSON.stringify(
          { valid: false, errors: [`Policy file not found: ${fullPath}`] },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }
    console.error(
      pc.red(`\n❌ Error: Policy file not found at: ${fullPath}\n`),
    );
    process.exitCode = 1;
    return;
  }

  try {
    const raw = fs.readFileSync(fullPath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_POLICY_BYTES) {
      throw new Error(
        `Policy file size exceeds maximum limit of ${MAX_POLICY_BYTES / 1024} KB`,
      );
    }
    const parsed = JSON.parse(raw);
    const rules = parsed.rules || (Array.isArray(parsed) ? parsed : []);
    const defaultDecision =
      parsed.policy?.default || parsed.defaultDecision || "ALLOW";
    const timeoutMs = parsed.approval?.timeoutMs || parsed.timeoutMs || 300000;

    const validation = validatePolicy(rules, defaultDecision, timeoutMs);

    if (options.json) {
      console.log(JSON.stringify(validation, null, 2));
      if (!validation.valid) process.exitCode = 2;
      return;
    }

    console.log(
      pc.bold(`\nAGENT MONITOR — Policy Validation: ${pc.white(fullPath)}\n`),
    );
    if (validation.valid) {
      console.log(
        pc.green(
          `  ✓ Policy is VALID (${rules.length} rules, default: ${defaultDecision}, timeout: ${timeoutMs}ms)\n`,
        ),
      );
      if (validation.warnings.length > 0) {
        console.log(pc.yellow("  Warnings:"));
        validation.warnings.forEach((w) => console.log(`    - ${w}`));
        console.log();
      }
    } else {
      console.log(
        pc.red(
          `  ❌ Policy is INVALID (${validation.errors.length} errors):\n`,
        ),
      );
      validation.errors.forEach((e) => console.log(`    ${pc.red("•")} ${e}`));
      console.log();
      process.exitCode = 2;
    }
  } catch (err: any) {
    if (options.json) {
      console.log(
        JSON.stringify({ valid: false, errors: [err.message] }, null, 2),
      );
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(`\n❌ Validation Error: ${err.message}\n`));
    process.exitCode = 1;
  }
}
