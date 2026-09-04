import { BehavioralMatch, BehavioralRule, BehavioralContext } from "./types.js";

function isSensitivePath(filePath: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  if (normalized.includes(".env")) return "Environment variable file (.env)";
  if (
    normalized.includes("/.ssh/") ||
    normalized.endsWith(".ssh") ||
    normalized.includes("id_rsa") ||
    normalized.includes("id_ed25519")
  ) {
    return "SSH private key or configuration";
  }
  if (
    normalized.includes("credentials") ||
    normalized.includes("service-account") ||
    normalized.includes("auth.json")
  ) {
    return "Credential or service account key";
  }
  if (
    normalized.endsWith(".pem") ||
    normalized.endsWith(".key") ||
    normalized.endsWith(".pfx") ||
    normalized.endsWith(".p12")
  ) {
    return "Cryptographic private key or certificate";
  }
  return null;
}

function isOutboundNetworkCommand(cmd: string): boolean {
  if (!cmd) return false;
  const trimmed = cmd.trim();
  const binary = trimmed.split(/\s+/)[0]?.toLowerCase();
  return (
    binary === "curl" ||
    binary === "wget" ||
    binary === "nc" ||
    binary === "ncat" ||
    binary === "socat" ||
    binary === "telnet" ||
    trimmed.includes("curl ") ||
    trimmed.includes("wget ")
  );
}

function isGitPushCommand(cmd: string): boolean {
  if (!cmd) return false;
  return /git\s+push(\s+.*)?$/i.test(cmd.trim());
}

/**
 * Rule 1: Sensitive file read followed by network request / outbound transfer
 */
export const SENSITIVE_TO_NETWORK_RULE: BehavioralRule = {
  id: "SEC_SENSITIVE_TO_NETWORK",
  name: "Sensitive Data to Network Flow",
  description:
    "Detects outbound network transmission following sensitive file access (exfiltration risk)",
  severity: "CRITICAL",
  evaluate(context, action) {
    if (context.sensitiveReads.length === 0) return null;

    const isNetworkAction = action.kind === "network.request";
    const isNetworkProcess =
      action.kind === "process.exec" &&
      isOutboundNetworkCommand(action.params.command || "");

    if (!isNetworkAction && !isNetworkProcess) return null;

    const lastSensitive =
      context.sensitiveReads[context.sensitiveReads.length - 1];
    return {
      ruleId: "SEC_SENSITIVE_TO_NETWORK",
      name: "Sensitive Data to Network Flow",
      severity: "CRITICAL",
      reason: `Outbound network operation detected after sensitive file access: ${lastSensitive.path} (${lastSensitive.sensitivityReason})`,
      triggeringActionId: action.actionId || "",
      triggeringActionKind: action.kind,
      priorActionIds: context.sensitiveReads.map((r) => r.actionId),
      timestamp: Date.now(),
    };
  },
};

/**
 * Rule 2: Sensitive file read followed by shell command execution
 */
export const SENSITIVE_TO_EXEC_RULE: BehavioralRule = {
  id: "SEC_SENSITIVE_TO_EXEC",
  name: "Sensitive Read to Command Execution",
  description: "Detects process execution after reading credentials or secrets",
  severity: "HIGH",
  evaluate(context, action) {
    if (context.sensitiveReads.length === 0) return null;
    if (action.kind !== "process.exec") return null;

    const lastSensitive =
      context.sensitiveReads[context.sensitiveReads.length - 1];
    return {
      ruleId: "SEC_SENSITIVE_TO_EXEC",
      name: "Sensitive Read to Command Execution",
      severity: "HIGH",
      reason: `Process execution detected after sensitive file read: ${lastSensitive.path}`,
      triggeringActionId: action.actionId || "",
      triggeringActionKind: action.kind,
      priorActionIds: context.sensitiveReads.map((r) => r.actionId),
      timestamp: Date.now(),
    };
  },
};

/**
 * Rule 3: Sensitive file read followed by git push
 */
export const SENSITIVE_TO_GIT_PUSH_RULE: BehavioralRule = {
  id: "SEC_SENSITIVE_TO_GIT_PUSH",
  name: "Sensitive Read to Git Push",
  description:
    "Detects git push following secret or credential access (repo exfiltration risk)",
  severity: "CRITICAL",
  evaluate(context, action) {
    if (context.sensitiveReads.length === 0) return null;
    if (action.kind !== "process.exec") return null;
    if (!isGitPushCommand(action.params.command || "")) return null;

    const lastSensitive =
      context.sensitiveReads[context.sensitiveReads.length - 1];
    return {
      ruleId: "SEC_SENSITIVE_TO_GIT_PUSH",
      name: "Sensitive Read to Git Push",
      severity: "CRITICAL",
      reason: `Remote git push detected after sensitive file access: ${lastSensitive.path}`,
      triggeringActionId: action.actionId || "",
      triggeringActionKind: action.kind,
      priorActionIds: context.sensitiveReads.map((r) => r.actionId),
      timestamp: Date.now(),
    };
  },
};

/**
 * Rule 4: Workspace modification followed by outbound network request
 */
export const WORKSPACE_MOD_TO_NETWORK_RULE: BehavioralRule = {
  id: "SEC_WORKSPACE_MOD_TO_NETWORK",
  name: "Workspace Modification to Network",
  description:
    "Detects outbound network transmission following local file modification",
  severity: "MEDIUM",
  evaluate(context, action) {
    if (context.workspaceWrites.length === 0) return null;

    const isNetworkAction = action.kind === "network.request";
    const isNetworkProcess =
      action.kind === "process.exec" &&
      isOutboundNetworkCommand(action.params.command || "");

    if (!isNetworkAction && !isNetworkProcess) return null;

    const lastWrite =
      context.workspaceWrites[context.workspaceWrites.length - 1];
    return {
      ruleId: "SEC_WORKSPACE_MOD_TO_NETWORK",
      name: "Workspace Modification to Network",
      severity: "MEDIUM",
      reason: `Outbound network operation following file modification: ${lastWrite.path}`,
      triggeringActionId: action.actionId || "",
      triggeringActionKind: action.kind,
      priorActionIds: context.workspaceWrites.map((w) => w.actionId),
      timestamp: Date.now(),
    };
  },
};

export const DEFAULT_BEHAVIORAL_RULES: BehavioralRule[] = [
  SENSITIVE_TO_NETWORK_RULE,
  SENSITIVE_TO_EXEC_RULE,
  SENSITIVE_TO_GIT_PUSH_RULE,
  WORKSPACE_MOD_TO_NETWORK_RULE,
];

export { isSensitivePath };
