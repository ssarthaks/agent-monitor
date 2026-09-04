import { createHash } from "node:crypto";
import { canonicalizeJson } from "../audit/hash.js";

export type McpSourceStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "QUARANTINED"
  | "STOPPED"
  | "CRASHED";

export type McpTrustState = "TRUSTED" | "UNTRUSTED" | "PROBATION";

export interface McpSourceRecord {
  sourceId: string; // e.g. "mcp:filesystem"
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  transport?: string;
  fingerprint?: string;
  toolSchemaFingerprint?: string;
  retrustRequired?: boolean;
  status: McpSourceStatus;
  pid?: number | null;
  startTime?: number | null;
  restartCount: number;
  consecutiveFailures: number;
  lastSeen: number;
  toolCount: number;
  quarantinedAt?: number | null;
  quarantinedBy?: string | null;
  quarantineReason?: string | null;
  trustState: McpTrustState;
}

export function computeSourceFingerprint(source: {
  command: string;
  args: string[];
  cwd?: string;
  transport?: string;
}): string {
  const normalized = {
    command: source.command,
    args: source.args || [],
    cwd: source.cwd || "",
    transport: source.transport || "stdio",
  };
  return createHash("sha256")
    .update(canonicalizeJson(normalized))
    .digest("hex");
}

export function computeToolSchemaFingerprint(
  tools: Array<{ name: string; description?: string; inputSchema?: any }>,
): string {
  const sorted = [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || {},
    }));
  return createHash("sha256").update(canonicalizeJson(sorted)).digest("hex");
}
