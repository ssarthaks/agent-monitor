import pc from "picocolors";
import {
  AgentEvent,
  AgentSession,
  SessionEndedEvent,
} from "@agent-monitor/core";

export function printStartupBanner(
  session: AgentSession,
  serverUrl: string,
  dashboardUrl: string,
): void {
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
      pc.bold(pc.white("AGENT MONITOR")) +
      " " +
      pc.dim("v0.2.0 — Policy Enforcement & Human Approval") +
      "    " +
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
  console.log(
    `  ${pc.bold("Agent:")}       ${pc.green(session.agentName)} (${session.model})`,
  );
  console.log(`  ${pc.bold("Session ID:")}  ${pc.yellow(session.id)}`);
  console.log(`  ${pc.bold("Workspace:")}   ${pc.dim(session.workspaceRoot)}`);
  console.log(`  ${pc.bold("Task:")}        ${pc.italic(session.task)}`);
  console.log(`  ${pc.bold("Server API:")}  ${pc.underline(serverUrl)}`);
  console.log(`  ${pc.bold("Dashboard:")}   ${pc.bold(pc.cyan(dashboardUrl))}`);
  console.log();
  console.log(
    pc.yellow(
      "  🛡️  POLICY ENGINE ACTIVE: V0.2 deterministic policy gates enforce ALLOW, DENY & ASK.",
    ),
  );
  console.log();
  console.log(
    pc.bold(
      pc.dim(
        "─── Live Action Stream ───────────────────────────────────────────────",
      ),
    ),
  );
}

export function printLiveEvent(event: AgentEvent): void {
  const timeStr = new Date(event.timestamp).toLocaleTimeString();

  switch (event.type) {
    case "agent.message": {
      const stepLabel = (event as any).step
        ? `Step ${(event as any).step}`
        : "Agent";
      const u = (event as any).usage;
      const usagePill = u
        ? pc.dim(
            ` [🪙 ${u.promptTokens.toLocaleString()} in${u.cacheHitTokens ? ` (${u.cacheHitTokens.toLocaleString()} cached)` : ""}, ${u.completionTokens.toLocaleString()} out • ${pc.green(`$${u.estimatedCostUsd.toFixed(6)}`)}]`,
          )
        : "";
      console.log(
        `\n${pc.dim(timeStr)} ${pc.bold(pc.magenta(`💬 ${stepLabel}:`))}${usagePill}`,
      );
      console.log(
        pc.gray(
          event.content
            .trim()
            .split("\n")
            .map((l) => `   ${l}`)
            .join("\n"),
        ),
      );
      break;
    }

    case "policy.evaluated": {
      let badge = pc.green("ALLOW");
      if (event.decision === "DENY") badge = pc.red("DENY");
      if (event.decision === "ASK")
        badge = pc.yellow("ASK (Approval Required)");
      console.log(
        `${pc.dim(timeStr)} ${pc.blue("⚖️ ")} ${pc.bold("policy.evaluated")} ${badge} ${pc.dim(`[rules: ${event.matchedPolicies.join(", ") || "default"}, spec: ${event.specificity}]`)}`,
      );
      break;
    }

    case "approval.requested": {
      const target = getActionTarget(event.actionKind, event.params);
      console.log(
        `${pc.dim(timeStr)} ${pc.bgYellow(pc.black(pc.bold(" ⚠️  WAITING FOR APPROVAL ")))} ${pc.bold(event.actionKind.padEnd(12))} ${target} ${formatRiskBadge(event.risk.level, event.risk.score)}`,
      );
      break;
    }

    case "approval.resolved": {
      const badge =
        event.decision === "approved"
          ? pc.bgGreen(pc.black(pc.bold(" ✓ APPROVED ")))
          : event.decision === "expired"
            ? pc.bgRed(pc.white(pc.bold(" ⌛ EXPIRED ")))
            : pc.bgRed(pc.white(pc.bold(" ⛔ DENIED ")));
      console.log(
        `${pc.dim(timeStr)} ${badge} ${pc.dim(`[resolved by: ${event.resolvedBy || "user"}]`)}`,
      );
      break;
    }

    case "action.started": {
      const riskBadge = formatRiskBadge(event.risk.level, event.risk.score);
      const target = getActionTarget(event.kind, event.params);
      console.log(
        `${pc.dim(timeStr)} ${pc.cyan("⏳")} ${pc.bold(event.kind.padEnd(14))} ${target} ${riskBadge}`,
      );
      break;
    }

    case "action.completed": {
      const riskBadge = formatRiskBadge(event.risk.level, event.risk.score);
      const target = getActionTarget(event.kind, event.params);
      const dur = pc.dim(`(${event.durationMs}ms)`);
      console.log(
        `${pc.dim(timeStr)} ${pc.green("✓")} ${pc.bold(event.kind.padEnd(14))} ${target} ${dur} ${riskBadge}`,
      );
      break;
    }

    case "action.failed": {
      const target = getActionTarget(event.kind, event.params);
      const dur = pc.dim(`(${event.durationMs}ms)`);
      console.log(
        `${pc.dim(timeStr)} ${pc.red("✗")} ${pc.bold(event.kind.padEnd(14))} ${target} ${dur} ${pc.red(`ERR: ${event.error.message}`)}`,
      );
      break;
    }

    case "action.blocked": {
      const target = getActionTarget(event.kind, event.params);
      console.log(
        `${pc.dim(timeStr)} ${pc.bgRed(pc.white(" BLOCKED "))} ${pc.bold(event.kind.padEnd(14))} ${target} ${pc.red(`REASON: ${event.reason}`)}`,
      );
      break;
    }
  }
}

export function printSummaryBanner(
  summary: SessionEndedEvent["summary"] & {
    approvedCount?: number;
    blockedCount?: number;
  },
  durationMs: number,
): void {
  const durSec = (durationMs / 1000).toFixed(1);
  const riskColor =
    summary.overallRiskScore >= 60
      ? pc.red
      : summary.overallRiskScore >= 30
        ? pc.yellow
        : pc.green;

  console.log();
  console.log(
    pc.bold(
      pc.dim(
        "─── Session Summary ──────────────────────────────────────────────────",
      ),
    ),
  );
  console.log();
  console.log(`  ${pc.bold("Runtime:")}          ${durSec}s`);
  console.log(`  ${pc.bold("Total Actions:")}    ${summary.totalActions}`);
  console.log(`  ${pc.bold("Files Read:")}       ${summary.filesRead}`);
  console.log(`  ${pc.bold("Files Written:")}    ${summary.filesWritten}`);
  console.log(`  ${pc.bold("Commands Run:")}     ${summary.commandsRun}`);
  if (summary.usage) {
    const u = summary.usage;
    console.log(
      `  ${pc.bold("Input Tokens:")}     ${u.promptTokens.toLocaleString()}${u.cacheHitTokens ? pc.dim(` (${u.cacheHitTokens.toLocaleString()} cached)`) : ""}`,
    );
    console.log(
      `  ${pc.bold("Output Tokens:")}    ${u.completionTokens.toLocaleString()}`,
    );
    console.log(
      `  ${pc.bold("Total Tokens:")}     ${pc.cyan(u.totalTokens.toLocaleString())}`,
    );
    const costStr =
      u.estimatedCostUsd < 0.01
        ? `$${u.estimatedCostUsd.toFixed(6)} USD`
        : `$${u.estimatedCostUsd.toFixed(4)} USD`;
    console.log(
      `  ${pc.bold("Estimated Cost:")}   ${pc.green(pc.bold(costStr))}`,
    );
  }
  if (summary.approvedCount !== undefined) {
    console.log(
      `  ${pc.bold("Approved Actions:")} ${pc.green(summary.approvedCount.toString())}`,
    );
  }
  if (summary.blockedCount !== undefined) {
    console.log(
      `  ${pc.bold("Blocked Actions:")}  ${pc.red(summary.blockedCount.toString())}`,
    );
  }
  console.log(
    `  ${pc.bold("Errors:")}           ${summary.errorsCount > 0 ? pc.red(summary.errorsCount) : "0"}`,
  );
  console.log(
    `  ${pc.bold("Overall Risk:")}     ${riskColor(pc.bold(`${summary.overallRiskScore}/100`))}`,
  );
  console.log();
  console.log(
    pc.bold(
      pc.cyan(
        "══════════════════════════════════════════════════════════════════════",
      ),
    ),
  );
  console.log();
}

function formatRiskBadge(level: string, score: number): string {
  if (level === "NONE" || score === 0) return "";
  if (level === "CRITICAL")
    return pc.bgRed(pc.white(pc.bold(` CRITICAL (${score}) `)));
  if (level === "HIGH") return pc.red(pc.bold(`⚠ HIGH (${score})`));
  if (level === "MEDIUM") return pc.yellow(`⚠ MEDIUM (${score})`);
  return pc.dim(`(risk: ${score})`);
}

function getActionTarget(kind: string, params: Record<string, any>): string {
  if (kind.startsWith("file.")) {
    return pc.white(params.path || "");
  }
  if (kind === "process.exec") {
    return pc.cyan(`"${params.command || ""}"`);
  }
  return JSON.stringify(params);
}
