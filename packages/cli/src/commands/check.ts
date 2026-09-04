import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import {
  PolicyEngine,
  RiskAnalyzer,
  ActionKind,
  ActionCategory,
} from "@agent-monitor/core";
import { resolveSafeWorkspacePath } from "@agent-monitor/agent";

export interface PolicyCheckOptions {
  action?: string;
  command?: string;
  path?: string;
  workspace?: string;
  config?: string;
}

export async function runPolicyCheckCommand(
  options: PolicyCheckOptions,
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const configPath = options.config
    ? path.resolve(options.config)
    : path.join(workspaceRoot, "agent-monitor.config.json");

  let policyEngine: PolicyEngine;
  if (fs.existsSync(configPath)) {
    try {
      const config = PolicyEngine.loadFromFile(configPath);
      policyEngine = new PolicyEngine(config);
    } catch (err: any) {
      console.error(pc.red(`\n❌ Configuration Error: ${err.message}\n`));
      process.exit(1);
    }
  } else {
    policyEngine = new PolicyEngine();
  }

  const actionKind = (options.action ||
    (options.command ? "process.exec" : "file.read")) as ActionKind;
  let category: ActionCategory = "file";
  if (actionKind.startsWith("process.")) category = "process";
  if (actionKind.startsWith("network.")) category = "network";

  const params: Record<string, any> = {};
  if (options.command) params.command = options.command;
  if (options.path) params.path = options.path;

  // 1. Check workspace containment
  let isOutsideWorkspace = false;
  if (params.path) {
    const pathCheck = resolveSafeWorkspacePath(params.path, workspaceRoot);
    isOutsideWorkspace = pathCheck.isOutsideWorkspace;
  }

  // 2. Calculate Risk (Dry-Run)
  const riskAnalyzer = new RiskAnalyzer();
  const risk = riskAnalyzer.analyze(actionKind, params, {
    isOutsideWorkspace,
  });

  // 3. Evaluate Policy (Dry-Run)
  const evaluation = policyEngine.evaluate(
    {
      kind: actionKind,
      category,
      params,
      risk,
    },
    {
      workspaceRoot,
      isOutsideWorkspace,
    },
  );

  // 3. Render Formatted Output
  console.log(
    "\n" +
      pc.bold(
        pc.cyan(
          "╔════════════════════════════════════════════════════════════════════╗",
        ),
      ),
  );
  console.log(
    pc.bold(pc.cyan("║")) +
      "  " +
      pc.bold(pc.white("AGENT MONITOR — Policy Dry Run Simulator")) +
      " " +
      pc.dim("(V0.3)") +
      "          " +
      pc.bold(pc.cyan("║")),
  );
  console.log(
    pc.bold(
      pc.cyan(
        "╚════════════════════════════════════════════════════════════════════╝",
      ),
    ),
  );
  console.log();
  console.log(`  ${pc.bold("Action:")}         ${pc.white(actionKind)}`);
  if (params.command) {
    console.log(`  ${pc.bold("Command:")}        ${pc.cyan(params.command)}`);
  }
  if (params.path) {
    console.log(`  ${pc.bold("Path:")}           ${pc.cyan(params.path)}`);
    if (isOutsideWorkspace) {
      console.log(
        `  ${pc.bold("Workspace:")}      ${pc.red("OUTSIDE WORKSPACE")}`,
      );
    }
  }
  console.log(
    `  ${pc.bold("Risk Score:")}     ${
      risk.score >= 50
        ? pc.red(`${risk.score}/100 (${risk.level})`)
        : pc.green(`${risk.score}/100 (${risk.level})`)
    }`,
  );
  console.log();

  let decisionBadge = pc.green("● ALLOW (Permitted to execute immediately)");
  if (evaluation.decision === "DENY") {
    decisionBadge = pc.red("⛔ DENY (Blocked by policy — will not execute)");
  } else if (evaluation.decision === "ASK") {
    decisionBadge = pc.yellow(
      "⚠️  ASK (Requires human approval before execution)",
    );
  }

  console.log(`  ${pc.bold("Decision:")}       ${decisionBadge}`);
  console.log(
    `  ${pc.bold("Specificity:")}    ${pc.dim(evaluation.specificity.toString())}`,
  );
  console.log(
    `  ${pc.bold("Matched Rules:")}  ${
      evaluation.matchedPolicies.length > 0
        ? pc.yellow(evaluation.matchedPolicies.join(", "))
        : pc.dim("(default fallback)")
    }`,
  );
  console.log(`  ${pc.bold("Reason:")}         ${pc.white(evaluation.reason)}`);
  console.log();
}
