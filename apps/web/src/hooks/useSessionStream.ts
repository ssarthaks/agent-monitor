"use client";

import { useState, useEffect, useRef } from "react";
import {
  AgentEvent,
  AgentSession,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionFailedEvent,
  ActionBlockedEvent,
} from "@agent-monitor/core";

export interface ActionItem {
  actionId: string;
  kind: string;
  category: string;
  params: Record<string, any>;
  status: "running" | "completed" | "failed" | "blocked";
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  risk: ActionStartedEvent["risk"];
  result?: any;
  error?: { message: string; code?: string };
  metadata?: ActionCompletedEvent["metadata"];
  reason?: string;
}

export function useSessionStream(targetSessionId?: string | null) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allSessions, setAllSessions] = useState<AgentSession[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const serverBase =
    process.env.NEXT_PUBLIC_SERVER_URL || "http://127.0.0.1:4040";

  useEffect(() => {
    async function loadSessions() {
      try {
        const res = await fetch(`${serverBase}/sessions`);
        if (res.ok) {
          const data = await res.json();
          setAllSessions(data.sessions || []);
        }
      } catch (err: any) {
        // Server might be offline
      }
    }
    loadSessions();
    const timer = setInterval(loadSessions, 5000);
    return () => clearInterval(timer);
  }, [serverBase]);

  useEffect(() => {
    let activeSessionId = targetSessionId;
    if (!activeSessionId && allSessions.length > 0) {
      activeSessionId = allSessions[0].id;
    }
    if (!activeSessionId) return;

    let isMounted = true;

    async function loadFromSQLite() {
      try {
        const resSession = await fetch(
          `${serverBase}/sessions/${activeSessionId}`,
        );
        if (!resSession.ok) throw new Error("Session not found in SQLite");
        const sessionData = await resSession.json();

        const resEvents = await fetch(
          `${serverBase}/sessions/${activeSessionId}/events`,
        );
        if (!resEvents.ok) throw new Error("Failed to fetch session events");
        const eventsData = await resEvents.json();

        if (isMounted) {
          setSession(sessionData.session);
          setEvents(eventsData.events || []);
          reconstructActions(eventsData.events || []);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      }
    }

    loadFromSQLite();

    const sseUrl = `${serverBase}/events/stream?sessionId=${activeSessionId}`;
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      if (isMounted) setIsConnected(true);
    };

    es.onerror = () => {
      if (isMounted) setIsConnected(false);
    };

    es.onmessage = (msg) => {
      try {
        if (msg.data && msg.data.startsWith("{")) {
          const event: AgentEvent = JSON.parse(msg.data);
          handleIncomingEvent(event);
        }
      } catch {
        // Heartbeat or malformed
      }
    };

    const eventTypes = [
      "session.started",
      "session.ended",
      "agent.message",
      "action.started",
      "action.completed",
      "action.failed",
      "action.blocked",
    ];

    eventTypes.forEach((type) => {
      es.addEventListener(type, (e: any) => {
        try {
          const event: AgentEvent = JSON.parse(e.data);
          handleIncomingEvent(event);
        } catch {
          // ignore
        }
      });
    });

    function handleIncomingEvent(event: AgentEvent) {
      if (!isMounted) return;

      setEvents((prev) => {
        if (prev.some((p) => p.id === event.id)) return prev;
        return [...prev, event];
      });

      if (event.type === "session.started") {
        setSession((prev) =>
          prev
            ? { ...prev, status: "running" }
            : {
                id: event.sessionId,
                agentId: event.agentId,
                agentName: event.agentName,
                provider: event.provider,
                model: event.model,
                workspaceRoot: event.workspaceRoot,
                task: event.task,
                startedAt: event.timestamp,
                status: "running",
                riskScore: 0,
              },
        );
      } else if (event.type === "session.ended") {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: event.status,
                endedAt: event.timestamp,
                summary: event.summary,
                riskScore: event.summary.overallRiskScore,
              }
            : null,
        );
      }

      setActions((prev) => updateActionList(prev, event));
    }

    return () => {
      isMounted = false;
      es.close();
      eventSourceRef.current = null;
    };
  }, [targetSessionId, allSessions.length, serverBase]);

  function reconstructActions(evList: AgentEvent[]) {
    let list: ActionItem[] = [];
    for (const ev of evList) {
      list = updateActionList(list, ev);
    }
    setActions(list);
  }

  function updateActionList(
    current: ActionItem[],
    event: AgentEvent,
  ): ActionItem[] {
    if (event.type === "action.started") {
      const item: ActionItem = {
        actionId: event.actionId,
        kind: event.kind,
        category: event.category,
        params: event.params,
        status: "running",
        startedAt: event.timestamp,
        risk: event.risk,
      };
      return [...current.filter((a) => a.actionId !== event.actionId), item];
    }

    if (event.type === "action.completed") {
      return current.map((a) => {
        if (a.actionId !== event.actionId) return a;
        return {
          ...a,
          status: "completed",
          completedAt: event.timestamp,
          durationMs: event.durationMs,
          result: event.result,
          metadata: event.metadata,
          risk: event.risk || a.risk,
        };
      });
    }

    if (event.type === "action.failed") {
      return current.map((a) => {
        if (a.actionId !== event.actionId) return a;
        return {
          ...a,
          status: "failed",
          completedAt: event.timestamp,
          durationMs: event.durationMs,
          error: event.error,
        };
      });
    }

    if (event.type === "action.blocked") {
      const item: ActionItem = {
        actionId: event.actionId,
        kind: event.kind,
        category: event.category,
        params: event.params,
        status: "blocked",
        startedAt: event.timestamp,
        completedAt: event.timestamp,
        reason: event.reason,
        risk: event.risk,
      };
      return [...current.filter((a) => a.actionId !== event.actionId), item];
    }

    return current;
  }

  return {
    session,
    events,
    actions,
    isConnected,
    error,
    allSessions,
  };
}
