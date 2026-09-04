import path from "node:path";
import { PolicyRule, PolicyActionContext, EvaluatedAction } from "./types.js";

// Calculates deterministic, additive specificity for a PolicyRule.
// Specificity is the sum of applicable dimensions:
// 1. Action Dimension:
//    - Exact action (e.g. 'file.read', 'process.exec') = 20
//    - Category wildcard (e.g. 'file.*', 'process.*') = 10
//    - Universal wildcard ('*', undefined) = 0
// 2. Path Dimension:
//    - Path traversal boundary / exact file (e.g. outside workspace, '.env', 'credentials.json') = 50
//    - Sub-directory or extension glob (e.g. 'src/**', '**/.env*') = 30
//    - Broad glob (e.g. '**/*', '*', '**') = 10
//    - None = 0
// 3. Command Dimension:
//    - Exact command (e.g. 'npm test', 'git status') = 50
//    - Sub-command pattern (e.g. 'git push *', 'npm install *') = 40
//    - Base command pattern (e.g. 'git *', 'npm *') = 20
//    - Universal wildcard ('*') = 10
//    - None = 0
// 4. Context Dimension:
//    - Targeted agent or risk score condition = +10
export function calculateRuleSpecificity(rule: PolicyRule): number {
  let score = 0;

  // 1. Action Dimension
  if (rule.action && rule.action !== "*") {
    if (rule.action.endsWith(".*")) {
      score += 10;
    } else {
      score += 20;
    }
  }

  // 2. Path Dimension
  if (rule.id === "deny-outside-workspace") {
    score += 50; // Workspace boundary rule
  } else if (rule.id === "ask-mutated-tools") {
    score += 45; // Dynamic tool rug-pull protection rule
  } else if (rule.path) {
    if (!rule.path.includes("*") && !rule.path.includes("?")) {
      score += 50; // Exact path match
    } else if (
      rule.path === "**/*" ||
      rule.path === "*" ||
      rule.path === "**"
    ) {
      score += 10; // Broad wildcard
    } else {
      score += 30; // Specific glob pattern
    }
  }

  // 3. Command Dimension
  if (rule.command) {
    if (!rule.command.includes("*") && !rule.command.includes("?")) {
      score += 50; // Exact command match
    } else if (rule.command === "*") {
      score += 10; // Universal command match
    } else {
      const tokens = rule.command.trim().split(/\s+/);
      if (tokens.length >= 3 || (tokens.length === 2 && tokens[1] !== "*")) {
        score += 40; // Subcommand glob (e.g. 'git push *', 'rm -rf *')
      } else {
        score += 20; // Base command glob (e.g. 'git *', 'npm *')
      }
    }
  }

  // 4. Context Dimension
  if (rule.agentId) score += 10;
  if (rule.maxRiskScore !== undefined) score += 10;
  if (rule.when?.priorSensitiveRead) score += 15;
  if (rule.when?.priorWorkspaceWrite) score += 10;
  if (rule.when?.source) score += 10;

  return score;
}

// Converts a glob pattern to a standard regular expression with accurate recursive wildcard support.
export function globToRegex(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, "/");

  // Step 1: Replace glob tokens with placeholders
  p = p.replace(/(^|\/)\*\*(\/|$)/g, (_match, prefix, suffix) => {
    if (prefix === "/" && suffix === "/") {
      return "/§GLOBSTAR_MID§";
    }
    if (prefix === "/" && suffix === "") {
      return "§GLOBSTAR_END§";
    }
    if (prefix === "" && suffix === "/") {
      return "§GLOBSTAR_START§";
    }
    return "§GLOBSTAR_ALL§";
  });

  p = p.replace(/\*\*/g, "§GLOBSTAR_ALL§");
  p = p.replace(/\*/g, "§STAR§");
  p = p.replace(/\?/g, "§QUESTION§");

  // Step 2: Escape regex special characters in the literal parts
  p = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Step 3: Replace placeholders with final regex constructs
  p = p.replace(/§GLOBSTAR_START§/g, "(?:^|.*/)");
  p = p.replace(/§GLOBSTAR_MID§/g, "(?:.*/)?");
  p = p.replace(/§GLOBSTAR_END§/g, "(?:/.*)?");
  p = p.replace(/§GLOBSTAR_ALL§/g, ".*");
  p = p.replace(/§STAR§/g, "[^/]*");
  p = p.replace(/§QUESTION§/g, "[^/]");

  return new RegExp(`^${p}$`, "i");
}

/**
 * Matches an action kind against an action pattern (e.g., 'file.read' against 'file.*' or 'file.read').
 */
export function matchActionKind(
  pattern: string | undefined,
  kind: string,
): boolean {
  if (!pattern || pattern === "*") return true;
  if (pattern === kind) return true;

  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return kind.startsWith(`${prefix}.`);
  }

  return false;
}

/**
 * Matches a target path against a glob pattern.
 */
export function matchPath(
  pattern: string | undefined,
  targetPath: string,
  workspaceRoot: string,
): boolean {
  if (!pattern || pattern === "*") return true;
  if (!targetPath) return false;

  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedTarget = targetPath.replace(/\\/g, "/");

  // Exact file name match without directory or wildcards (e.g. 'credentials.json' matches 'src/credentials.json')
  if (!normalizedPattern.includes("/") && !normalizedPattern.includes("*")) {
    const basename = path.basename(normalizedTarget);
    return basename.toLowerCase() === normalizedPattern.toLowerCase();
  }

  // Handle Home directory patterns (e.g. ~/.ssh/**)
  if (normalizedPattern.startsWith("~")) {
    const patternSub = normalizedPattern.replace(/^~[/\\]?/, "");
    if (normalizedTarget.includes(patternSub) || targetPath.includes(".ssh")) {
      return true;
    }
  }

  // Exclude non-secret example/template/sample files from .env secret matching
  if (normalizedPattern.includes(".env")) {
    const base = path.basename(normalizedTarget).toLowerCase();
    if (
      /(\.(sample|example|template|dist|default)$|-(sample|example|template)$)/i.test(
        base,
      )
    ) {
      return false;
    }
  }

  const regex = globToRegex(normalizedPattern);

  if (regex.test(normalizedTarget)) return true;

  // Also test relative to workspace
  if (workspaceRoot) {
    const normalizedWs = workspaceRoot.replace(/\\/g, "/");
    if (normalizedTarget.startsWith(normalizedWs)) {
      const relPath = normalizedTarget
        .slice(normalizedWs.length)
        .replace(/^[/\\]/, "");
      if (regex.test(relPath)) return true;
    }
  }

  return false;
}

/**
 * Normalizes a shell command string by stripping common execution wrappers
 * (sudo, doas, env, sh -c, bash -c) and standardizing whitespace and rm flag permutations.
 */
export function normalizeCommand(cmd: string): string {
  let current = cmd.trim();
  // Unwrap execution prefixes iteratively
  while (true) {
    const sudoMatch = current.match(
      /^(?:sudo|doas|env(?:\s+-[a-zA-Z0-9_-]+)*)\s+(.*)$/i,
    );
    if (sudoMatch) {
      current = sudoMatch[1].trim();
      continue;
    }
    const shellMatch = current.match(
      /^(?:(?:ba|z)?sh|dash)\s+-c\s+["'](.*?)["']$/i,
    );
    if (shellMatch) {
      current = shellMatch[1].trim();
      continue;
    }
    break;
  }

  // Collapse multiple whitespace
  current = current.replace(/\s+/g, " ");

  // Standardize rm flags (e.g. rm -fr, rm -r -f, rm -f -r -> rm -rf)
  current = current.replace(
    /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f\b|-[a-zA-Z]*f[a-zA-Z]*r\b|-r\s+-f|-f\s+-r)\b/i,
    "rm -rf",
  );

  return current;
}

/**
 * Matches a shell command string against a command pattern (e.g. 'git push origin main' matches 'git push *').
 */
export function matchCommand(
  pattern: string | undefined,
  command: string,
): boolean {
  if (!pattern || pattern === "*") return true;
  if (!command) return false;

  const trimmedPattern = pattern.trim().replace(/\s+/g, " ");
  const trimmedCommand = command.trim().replace(/\s+/g, " ");
  const normalizedCommand = normalizeCommand(command);

  // Exact match
  if (trimmedPattern === trimmedCommand || trimmedPattern === normalizedCommand)
    return true;

  // Command prefix glob (e.g. 'git push *' or 'git *')
  if (trimmedPattern.endsWith("*")) {
    const prefix = trimmedPattern.slice(0, -1).trim();
    if (
      trimmedCommand === prefix ||
      trimmedCommand.startsWith(`${prefix} `) ||
      trimmedCommand.startsWith(prefix) ||
      normalizedCommand === prefix ||
      normalizedCommand.startsWith(`${prefix} `) ||
      normalizedCommand.startsWith(prefix)
    ) {
      return true;
    }
  }

  // Regex pattern matching
  const regexStr =
    "^" +
    trimmedPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".") +
    "$";

  const rx = new RegExp(regexStr, "i");
  return rx.test(trimmedCommand) || rx.test(normalizedCommand);
}

/**
 * Checks if an evaluated action matches a given PolicyRule.
 */
export function matchesRule(
  rule: PolicyRule,
  action: EvaluatedAction,
  context: PolicyActionContext,
): boolean {
  // Security Boundary: An ALLOW rule can never allow an action that is outside the workspace
  if (context.isOutsideWorkspace && rule.decision === "ALLOW") {
    return false;
  }

  // Authoritative Containment: If target is outside workspace, deny-outside-workspace ALWAYS matches
  if (rule.id === "deny-outside-workspace" && context.isOutsideWorkspace) {
    return true;
  }

  // Authoritative Rug-Pull Protection: ask-mutated-tools matches if tool schema was dynamically mutated
  if (rule.id === "ask-mutated-tools") {
    return Boolean(context.isToolMutated);
  }

  // 1. Action Kind Match
  const kindStr = String(action.kind);
  if (!matchActionKind(rule.action, kindStr)) {
    // If rule matches file.* and action category is file, allow match
    if (rule.action === "file.*" && action.category === "file") {
      // match accepted
    } else {
      return false;
    }
  }

  // 2. Agent ID Match (if specified in rule)
  if (rule.agentId && context.agentId && rule.agentId !== context.agentId) {
    return false;
  }

  // 3. Path Traversal Context
  if (rule.id === "deny-outside-workspace") {
    return Boolean(context.isOutsideWorkspace);
  }

  // 4. Path Pattern Match (for file actions)
  if (rule.path) {
    const targetPath = String(action.params.path || "");
    if (
      !targetPath ||
      !matchPath(rule.path, targetPath, context.workspaceRoot)
    ) {
      return false;
    }
  }

  // 5. Command Pattern Match (for process.exec actions)
  if (rule.command) {
    const targetCmd = String(action.params.command || "");
    if (!targetCmd || !matchCommand(rule.command, targetCmd)) {
      return false;
    }
  }

  // 6. Max Risk Score threshold (if rule specifies a threshold)
  if (rule.maxRiskScore !== undefined && action.risk) {
    if (action.risk.score > rule.maxRiskScore && rule.decision === "ALLOW") {
      return false; // Exceeds allowed risk
    }
  }

  // 7. Behavioral & Sequence Context (when conditions)
  if (rule.when) {
    if (rule.when.priorSensitiveRead && !context.hasPriorSensitiveRead) {
      return false;
    }
    if (rule.when.priorWorkspaceWrite && !context.hasPriorWorkspaceWrite) {
      return false;
    }
    if (rule.when.source) {
      const actualSource =
        context.source || (action.source?.type ? `${action.source.type}` : "");
      if (
        rule.when.source !== "*" &&
        actualSource !== rule.when.source &&
        !actualSource.startsWith(`${rule.when.source}:`)
      ) {
        return false;
      }
    }
  }

  return true;
}
