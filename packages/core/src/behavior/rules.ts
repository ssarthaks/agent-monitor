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

/**
 * Rule 5: Mutated tool definition followed by sensitive credential read
 */
export const MUTATION_TO_READ_RULE: BehavioralRule = {
  id: "SEC_MUTATION_TO_READ",
  name: "Tool Mutation to Sensitive Read",
  description:
    "Detects sensitive credential or secret access following an unapproved tool schema mutation",
  severity: "CRITICAL",
  evaluate(context, action) {
    if (context.mutatedTools.length === 0) return null;
    if (action.kind !== "file.read") return null;

    const path = action.params?.path || "";
    const sensitivity = isSensitivePath(path);
    if (!sensitivity) return null;

    const lastMutation = context.mutatedTools[context.mutatedTools.length - 1];
    return {
      ruleId: "SEC_MUTATION_TO_READ",
      name: "Tool Mutation to Sensitive Read",
      severity: "CRITICAL",
      reason: `Sensitive credential read detected (${path}) following tool schema mutation of '${lastMutation.toolName}'`,
      triggeringActionId: action.actionId || "",
      triggeringActionKind: action.kind,
      priorActionIds: context.mutatedTools.map((m) => m.actionId),
      timestamp: Date.now(),
    };
  },
};

/**
 * Rule 6: Workspace traversal attempt followed by command execution
 */
export const TRAVERSAL_TO_EXEC_RULE: BehavioralRule = {
  id: "SEC_TRAVERSAL_TO_EXEC",
  name: "Workspace Traversal to Command Execution",
  description:
    "Detects shell command execution following a blocked workspace traversal attempt",
  severity: "HIGH",
  evaluate(context, action) {
    if (action.kind !== "process.exec") return null;
    const traversalBlocks = context.blockedActions.filter(
      (b) =>
        b.reason.toLowerCase().includes("workspace") ||
        b.reason.toLowerCase().includes("traversal") ||
        b.reason.toLowerCase().includes("rfc 8089"),
    );
    if (traversalBlocks.length === 0) return null;

    const lastTraversal = traversalBlocks[traversalBlocks.length - 1];
    return {
      ruleId: "SEC_TRAVERSAL_TO_EXEC",
      name: "Workspace Traversal to Command Execution",
      severity: "HIGH",
      reason: `Command execution detected following blocked workspace traversal: ${lastTraversal.reason}`,
      triggeringActionId: action.actionId || "",
      triggeringActionKind: action.kind,
      priorActionIds: traversalBlocks.map((b) => b.actionId),
      timestamp: Date.now(),
    };
  },
};

/**
 * Rule 7: Repeated policy denials followed by alternative tool probe
 */
export const DENIAL_TO_ALTERNATIVE_RULE: BehavioralRule = {
  id: "SEC_DENIAL_TO_ALTERNATIVE",
  name: "Repeated Denials to Tool Probe",
  description:
    "Detects switching to alternative tools or actions after multiple policy denials",
  severity: "HIGH",
  evaluate(context, action) {
    if (context.blockedActions.length < 2) return null;

    // Check if the current action is different in kind or tool from prior blocked actions
    const priorBlockedKinds = new Set(
      context.blockedActions.map((b) => b.kind),
    );
    const isProbe = !priorBlockedKinds.has(action.kind);

    if (!isProbe) return null;

    return {
      ruleId: "SEC_DENIAL_TO_ALTERNATIVE",
      name: "Repeated Denials to Tool Probe",
      severity: "HIGH",
      reason: `Probing alternative action '${action.kind}' after ${context.blockedActions.length} policy denials`,
      triggeringActionId: action.actionId || "",
      triggeringActionKind: action.kind,
      priorActionIds: context.blockedActions.map((b) => b.actionId),
      timestamp: Date.now(),
    };
  },
};

export const DEFAULT_BEHAVIORAL_RULES: BehavioralRule[] = [
  SENSITIVE_TO_NETWORK_RULE,
  SENSITIVE_TO_EXEC_RULE,
  SENSITIVE_TO_GIT_PUSH_RULE,
  WORKSPACE_MOD_TO_NETWORK_RULE,
  MUTATION_TO_READ_RULE,
  TRAVERSAL_TO_EXEC_RULE,
  DENIAL_TO_ALTERNATIVE_RULE,
];

export { isSensitivePath };
