export type IncidentSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type IncidentStatus =
  | "OPEN"
  | "INVESTIGATING"
  | "CONTAINED"
  | "RESOLVED"
  | "FALSE_POSITIVE";

export type IncidentTrigger =
  | "PRIVATE_KEY_LEAK"
  | "WORKSPACE_ESCAPE"
  | "TOOL_MUTATION"
  | "BEHAVIORAL_VIOLATION"
  | "REPEATED_POLICY_DENIAL"
  | "KILL_SWITCH_ACTIVATION"
  | "DOWNSTREAM_MCP_CRASH"
  | "RATE_LIMIT_EXCEEDED"
  | "SOURCE_QUARANTINED"
  | "OPERATOR_MANUAL";

export interface SecurityIncident {
  id: string; // e.g. "inc_01J..."
  incidentNumber: string; // e.g. "INC-00001"
  sessionId: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  triggerType: IncidentTrigger;
  title: string;
  description: string;
  triggerEventId?: string;
  relatedEventIds: string[];
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
}
