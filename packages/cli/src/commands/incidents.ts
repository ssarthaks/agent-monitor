import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";
import { IncidentStatus, IncidentSeverity } from "@agent-monitor/core";

export interface IncidentCliOptions {
  workspace?: string;
  db?: string;
  session?: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  notes?: string;
  json?: boolean;
}

function getRepo(options: IncidentCliOptions): {
  repo: SessionRepository;
  close: () => void;
} {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found at: ${dbPath}`);
  }

  const db = createDatabase(dbPath);
  const repo = new SessionRepository(db);
  return { repo, close: () => db.close() };
}

export async function runIncidentsListCommand(
  options: IncidentCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const incidents = repo.listIncidents({
      sessionId: options.session,
      status: options.status,
      severity: options.severity,
      limit: 50,
    });

    if (options.json) {
      console.log(JSON.stringify({ incidents }, null, 2));
      return;
    }

    console.log(pc.bold("\nAGENT MONITOR — Security Incidents\n"));
    if (incidents.length === 0) {
      console.log(
        pc.green("  ✓ No security incidents found matching criteria.\n"),
      );
      return;
    }

    for (const inc of incidents) {
      const sevColor =
        inc.severity === "CRITICAL"
          ? pc.red
          : inc.severity === "HIGH"
            ? pc.yellow
            : pc.cyan;

      console.log(
        `  ${pc.bold(inc.incidentNumber)} [${sevColor(inc.severity)}] [${pc.blue(inc.status)}] - ${pc.bold(inc.title)}`,
      );
      console.log(
        `    ID: ${inc.id} | Session: ${inc.sessionId} | Trigger: ${inc.triggerType} | Created: ${new Date(inc.createdAt).toISOString()}`,
      );
      if (inc.description) {
        console.log(`    Description: ${inc.description}`);
      }
      console.log();
    }
  } finally {
    close();
  }
}

export async function runIncidentShowCommand(
  incidentId: string,
  options: IncidentCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const incident = repo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    if (options.json) {
      console.log(JSON.stringify({ incident }, null, 2));
      return;
    }

    const sevColor =
      incident.severity === "CRITICAL"
        ? pc.red
        : incident.severity === "HIGH"
          ? pc.yellow
          : pc.cyan;

    console.log(pc.bold(`\nSECURITY INCIDENT — ${incident.incidentNumber}\n`));
    console.log(`  ID:           ${incident.id}`);
    console.log(`  Title:        ${incident.title}`);
    console.log(`  Severity:     ${sevColor(incident.severity)}`);
    console.log(`  Status:       ${pc.blue(incident.status)}`);
    console.log(`  Session ID:   ${incident.sessionId}`);
    console.log(`  Trigger Type: ${incident.triggerType}`);
    console.log(
      `  Created At:   ${new Date(incident.createdAt).toISOString()}`,
    );
    console.log(
      `  Updated At:   ${new Date(incident.updatedAt).toISOString()}`,
    );
    if (incident.triggerEventId) {
      console.log(`  Trigger Event:${incident.triggerEventId}`);
    }
    if (incident.description) {
      console.log(`  Description:  ${incident.description}`);
    }
    if (incident.resolutionNotes) {
      console.log(
        `  Resolution:   ${incident.resolutionNotes} (by ${incident.resolvedBy || "unknown"})`,
      );
    }
    console.log();
  } finally {
    close();
  }
}

export async function runIncidentUpdateCommand(
  incidentId: string,
  updates: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    notes?: string;
  },
  options: IncidentCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const updated = repo.updateIncident(incidentId, {
      status: updates.status,
      severity: updates.severity,
      resolutionNotes: updates.notes,
      resolvedBy: "operator-cli",
    });

    if (!updated) {
      throw new Error(`Incident '${incidentId}' not found to update`);
    }

    if (options.json) {
      console.log(
        JSON.stringify({ success: true, incident: updated }, null, 2),
      );
      return;
    }

    console.log(
      pc.green(`\n✓ Incident ${pc.bold(updated.incidentNumber)} updated`),
    );
    console.log(
      `  Status: ${pc.blue(updated.status)} | Severity: ${updated.severity}\n`,
    );
  } finally {
    close();
  }
}

export async function runIncidentEventsCommand(
  incidentId: string,
  options: IncidentCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const events = repo.getIncidentEvents(incidentId);

    if (options.json) {
      console.log(JSON.stringify({ events }, null, 2));
      return;
    }

    console.log(pc.bold(`\nINCIDENT EVENTS — ${incidentId}\n`));
    if (events.length === 0) {
      console.log(pc.dim("  No associated events found for this incident.\n"));
      return;
    }

    for (const evt of events) {
      console.log(
        `  #${evt.sequence} [${pc.cyan(evt.type)}] ${new Date(evt.timestamp).toISOString()}`,
      );
      if ((evt as any).actionId)
        console.log(`    Action ID: ${(evt as any).actionId}`);
      if ((evt as any).reason)
        console.log(`    Reason: ${(evt as any).reason}`);
      console.log();
    }
  } finally {
    close();
  }
}
