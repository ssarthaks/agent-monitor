import { ActionCategory, ActionKind } from "../actions/types.js";
import {
  BehavioralContext,
  BehavioralMatch,
  BehavioralRule,
  SensitiveAccessRecord,
  WorkspaceWriteRecord,
  ProcessExecRecord,
} from "./types.js";
import { DEFAULT_BEHAVIORAL_RULES, isSensitivePath } from "./rules.js";

const MAX_BEHAVIORAL_RECORDS = 200;

function trimArray<T>(arr: T[], limit: number): void {
  if (arr.length > limit) {
    arr.splice(0, arr.length - limit);
  }
}

export class BehavioralEngine {
  private rules: BehavioralRule[];
  private contexts = new Map<string, BehavioralContext>();

  constructor(rules: BehavioralRule[] = DEFAULT_BEHAVIORAL_RULES) {
    this.rules = rules;
  }

  getContext(sessionId: string): BehavioralContext {
    let ctx = this.contexts.get(sessionId);
    if (!ctx) {
      ctx = {
        sessionId,
        sensitiveReads: [],
        workspaceWrites: [],
        executedCommands: [],
        priorMatches: [],
      };
      this.contexts.set(sessionId, ctx);
    }
    return ctx;
  }

  /**
   * Pre-execution evaluation: returns matches if the incoming action triggers any sequence rules.
   */
  evaluate(
    sessionId: string,
    action: {
      actionId?: string;
      kind: ActionKind | string;
      category?: ActionCategory | string;
      params: Record<string, any>;
    },
  ): BehavioralMatch[] {
    const context = this.getContext(sessionId);
    const matches: BehavioralMatch[] = [];

    for (const rule of this.rules) {
      const match = rule.evaluate(context, action);
      if (match) {
        matches.push(match);
      }
    }

    return matches;
  }

  /**
   * Post-execution record: records completed action to update session sequence history.
   */
  recordAction(
    sessionId: string,
    action: {
      actionId: string;
      kind: ActionKind | string;
      category?: ActionCategory | string;
      params: Record<string, any>;
    },
  ): void {
    const context = this.getContext(sessionId);

    // 1. Check if this is a sensitive read
    if (action.kind === "file.read" && action.params?.path) {
      const sensitivity = isSensitivePath(action.params.path);
      if (sensitivity) {
        context.sensitiveReads.push({
          actionId: action.actionId,
          path: action.params.path,
          timestamp: Date.now(),
          sensitivityReason: sensitivity,
        });
        trimArray(context.sensitiveReads, MAX_BEHAVIORAL_RECORDS);
      }
    }

    // 2. Check if this is a file write
    if (action.kind === "file.write" && action.params?.path) {
      context.workspaceWrites.push({
        actionId: action.actionId,
        path: action.params.path,
        timestamp: Date.now(),
      });
      trimArray(context.workspaceWrites, MAX_BEHAVIORAL_RECORDS);
    }

    // 3. Check if this is process exec
    if (action.kind === "process.exec" && action.params?.command) {
      context.executedCommands.push({
        actionId: action.actionId,
        command: action.params.command,
        timestamp: Date.now(),
      });
      trimArray(context.executedCommands, MAX_BEHAVIORAL_RECORDS);
    }
  }

  /**
   * Reconstructs behavioral session state from historical events (e.g. loaded from SQLite).
   * Ensures that process restarts or multiple processes observing the same session maintain sequence awareness.
   */
  reconstructFromEvents(
    sessionId: string,
    events: Array<{
      type: string;
      actionId?: string;
      kind?: string;
      category?: string;
      params?: Record<string, any>;
      timestamp?: number;
    }>,
  ): void {
    const context = this.getContext(sessionId);
    for (const evt of events) {
      if (evt.type === "action.completed" && evt.actionId && evt.kind) {
        if (evt.kind === "file.read" && evt.params?.path) {
          const sensitivity = isSensitivePath(evt.params.path);
          if (sensitivity) {
            context.sensitiveReads.push({
              actionId: evt.actionId,
              path: evt.params.path,
              timestamp: evt.timestamp || Date.now(),
              sensitivityReason: sensitivity,
            });
            trimArray(context.sensitiveReads, MAX_BEHAVIORAL_RECORDS);
          }
        } else if (evt.kind === "file.write" && evt.params?.path) {
          context.workspaceWrites.push({
            actionId: evt.actionId,
            path: evt.params.path,
            timestamp: evt.timestamp || Date.now(),
          });
          trimArray(context.workspaceWrites, MAX_BEHAVIORAL_RECORDS);
        } else if (evt.kind === "process.exec" && evt.params?.command) {
          context.executedCommands.push({
            actionId: evt.actionId,
            command: evt.params.command,
            timestamp: evt.timestamp || Date.now(),
          });
          trimArray(context.executedCommands, MAX_BEHAVIORAL_RECORDS);
        }
      }
    }
  }

  clearSession(sessionId: string): void {
    this.contexts.delete(sessionId);
  }
}
