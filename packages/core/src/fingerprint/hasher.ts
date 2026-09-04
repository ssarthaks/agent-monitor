import crypto from "node:crypto";
import {
  ExternalToolDefinition,
  ToolComparisonStatus,
  ToolFingerprintComparison,
} from "./types.js";
import { canonicalizeJson } from "../audit/hash.js";

/**
 * Calculates a stable SHA-256 fingerprint for an external tool definition.
 * Key properties evaluated: tool name, description, and inputSchema.
 */
export function computeToolFingerprint(tool: ExternalToolDefinition): string {
  const canonicalObject = {
    name: tool.name,
    description: tool.description ? tool.description.trim() : "",
    inputSchema: tool.inputSchema || {},
  };

  const canonicalString = canonicalizeJson(canonicalObject);
  return crypto
    .createHash("sha256")
    .update(canonicalString, "utf8")
    .digest("hex");
}

/**
 * Compares an incoming tool definition against a previously established baseline.
 */
export function compareToolFingerprint(
  tool: ExternalToolDefinition,
  source: string,
  baselineFingerprint?: string,
): ToolFingerprintComparison {
  const currentFingerprint = computeToolFingerprint(tool);

  if (!baselineFingerprint) {
    return {
      status: "TOOL_DISCOVERED",
      toolName: tool.name,
      source,
      currentFingerprint,
    };
  }

  if (currentFingerprint === baselineFingerprint) {
    return {
      status: "TOOL_UNCHANGED",
      toolName: tool.name,
      source,
      currentFingerprint,
      baselineFingerprint,
    };
  }

  return {
    status: "TOOL_CHANGED",
    toolName: tool.name,
    source,
    currentFingerprint,
    baselineFingerprint,
    diffSummary: `Tool definition mutated: expected ${baselineFingerprint.slice(0, 12)}..., got ${currentFingerprint.slice(0, 12)}...`,
  };
}
