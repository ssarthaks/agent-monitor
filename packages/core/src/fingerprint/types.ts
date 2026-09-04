export type ToolComparisonStatus =
  | "TOOL_DISCOVERED"
  | "TOOL_UNCHANGED"
  | "TOOL_CHANGED";

export interface ExternalToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  [key: string]: any;
}

export interface ToolFingerprintRecord {
  id: string;
  sessionId: string;
  toolName: string;
  source: string; // e.g. "mcp:filesystem"
  fingerprint: string; // SHA-256 hex
  schemaJson: string;
  description: string;
  firstSeenAt: number;
  lastSeenAt: number;
  changeCount: number;
}

export interface ToolFingerprintComparison {
  status: ToolComparisonStatus;
  toolName: string;
  source: string;
  currentFingerprint: string;
  baselineFingerprint?: string;
  diffSummary?: string;
}
