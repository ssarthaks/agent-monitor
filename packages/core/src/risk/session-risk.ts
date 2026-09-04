import { AgentEvent } from "../events/types.js";
import { RiskContributor, RiskLevel, SessionRiskBreakdown } from "./types.js";

export function calculateSessionRisk(
  sessionId: string,
  events: AgentEvent[],
): SessionRiskBreakdown {
  const contributors: RiskContributor[] = [];
  let score = 0;
  let policyDenialCount = 0;

  for (const event of events) {
    let classifiedSpecific = false;

    // 1. Outside workspace execution attempts
    if (
      event.type === "action.blocked" &&
      event.reason &&
      (event.reason.includes("outside workspace") ||
        event.reason.includes("Workspace boundary violation") ||
        event.reason.includes("RFC 8089"))
    ) {
      classifiedSpecific = true;
      contributors.push({
        category: "WORKSPACE_ESCAPE",
        description: `Workspace boundary traversal attempt: ${(event as any).kind || "unknown"}`,
        scoreImpact: 30,
        timestamp: event.timestamp,
        eventId: event.id,
      });
      score += 30;
    }

    // 2. Tool schema mutation attempts
    if (
      event.type === "action.blocked" &&
      event.reason &&
      event.reason.includes("mutated")
    ) {
      classifiedSpecific = true;
      contributors.push({
        category: "MUTATED_TOOL",
        description: `Execution attempt on mutated tool schema: ${(event as any).kind || "unknown"}`,
        scoreImpact: 20,
        timestamp: event.timestamp,
        eventId: event.id,
      });
      score += 20;
    }

    // 3. Private key / credential leak detected
    if (
      (event.type === "action.blocked" &&
        event.reason &&
        (event.reason.includes("Private key") ||
          event.reason.includes("credential") ||
          event.reason.includes("Secret pattern"))) ||
      (event.type === "action.started" &&
        event.risk?.flags.some(
          (f) =>
            f.ruleId.includes("PRIVATE_KEY") || f.ruleId.includes("SECRET"),
        ))
    ) {
      classifiedSpecific = true;
      contributors.push({
        category: "SECRET_LEAK",
        description: "Private key or credential exfiltration detected",
        scoreImpact: 25,
        timestamp: event.timestamp,
        eventId: event.id,
      });
      score += 25;
    }

    // 4. Behavioral sequence matches
    if (event.type === "behavioral.match") {
      const match = (event as any).match;
      const impact =
        match?.severity === "CRITICAL"
          ? 40
          : match?.severity === "HIGH"
            ? 30
            : match?.severity === "MEDIUM"
              ? 20
              : 10;
      contributors.push({
        category: "BEHAVIORAL_ANOMALY",
        description: `Behavioral pattern triggered: ${match?.name || match?.ruleId}`,
        scoreImpact: impact,
        timestamp: event.timestamp,
        eventId: event.id,
      });
      score += impact;
    }

    // 5. Kill switch activations
    if (event.type === "control.kill_switch_enabled") {
      contributors.push({
        category: "KILL_SWITCH",
        description: `Kill switch triggered: ${(event as any).reason || "Emergency stop"}`,
        scoreImpact: 50,
        timestamp: event.timestamp,
        eventId: event.id,
      });
      score += 50;
    }

    // 6. Generic policy violations (denials not already counted above)
    if (
      !classifiedSpecific &&
      (event.type === "action.blocked" ||
        (event.type === "policy.evaluated" &&
          (event as any).decision === "DENY"))
    ) {
      policyDenialCount++;
      if (policyDenialCount <= 3) {
        contributors.push({
          category: "POLICY_VIOLATION",
          description: `Policy denied action (${policyDenialCount}): ${(event as any).reason || "Forbidden"}`,
          scoreImpact: 10,
          timestamp: event.timestamp,
          eventId: event.id,
        });
        score += 10;
      }
    }
  }

  // Bounded score between 0 and 100
  const boundedScore = Math.min(100, Math.max(0, score));

  let severity: RiskLevel = "NONE";
  if (boundedScore >= 80) severity = "CRITICAL";
  else if (boundedScore >= 50) severity = "HIGH";
  else if (boundedScore >= 25) severity = "MEDIUM";
  else if (boundedScore > 0) severity = "LOW";

  return {
    sessionId,
    score: boundedScore,
    severity,
    contributors,
    evaluatedAt: Date.now(),
  };
}
