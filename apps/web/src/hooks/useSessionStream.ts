"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  AgentEvent,
  AgentSession,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionFailedEvent,
  ActionBlockedEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  PolicyEvaluatedEvent,
  ApprovalRequest,
} from "@agent-monitor/core";

export interface ActionItem {
  actionId: string;
  kind: string;
  category: string;
  params: Record<string, any>;
  status:
    | "waiting_approval"
    | "approved"
    | "running"
    | "completed"
    | "failed"
    | "blocked";
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  risk: ActionStartedEvent["risk"];
  result?: any;
  error?: { message: string; code?: string };
  metadata?: ActionCompletedEvent["metadata"];
  reason?: string;
  approvalId?: string;
  policyReason?: string;
}

export function useSessionStream(targetSessionId?: string | null) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [pendingApproval, setPendingApproval] =
    useState<ApprovalRequest | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allSessions, setAllSessions] = useState<AgentSession[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastSeqRef = useRef<number>(0);

  const serverBase =
    typeof window !== "undefined" &&
    (window.location.port === "4040" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost")
      ? `${window.location.protocol}//${window.location.hostname}:4040`
      : process.env.NEXT_PUBLIC_SERVER_URL || "http://127.0.0.1:4040";

  // 1. Poll session list periodically to catch new sessions in real time
  useEffect(() => {
    async function loadSessions() {
      try {
        const res = await fetch(`${serverBase}/sessions?limit=50`);
        if (res.ok) {
          const data = await res.json();
          setAllSessions(data.sessions || []);
        }
      } catch {
        // Server offline
      }
    }
    loadSessions();
    const timer = setInterval(loadSessions, 2000);
    return () => clearInterval(timer);
  }, [serverBase]);

  // 2. Active Session Resolution
  const activeSessionId =
    targetSessionId || (allSessions.length > 0 ? allSessions[0].id : null);

  useEffect(() => {
    if (!activeSessionId) return;

    let isMounted = true;
    lastSeqRef.current = 0;

    // A. Initial Load from SQLite
    async function fetchSessionData() {
      try {
        const [resSession, resEvents, resApprovals] = await Promise.all([
          fetch(`${serverBase}/sessions/${activeSessionId}`),
          fetch(`${serverBase}/sessions/${activeSessionId}/events`),
          fetch(`${serverBase}/sessions/${activeSessionId}/approvals`),
        ]);

        if (!resSession.ok) throw new Error("Session not found");
        const sessionData = await resSession.json();
        const eventsData = await resEvents.json();
        const approvalsData = resApprovals.ok
          ? await resApprovals.json()
          : { approvals: [] };

        if (isMounted) {
          setSession(sessionData.session);
          const evList: AgentEvent[] = eventsData.events || [];
          setEvents(evList);
          reconstructActions(evList);

          const appList: ApprovalRequest[] = approvalsData.approvals || [];
          setApprovals(appList);
          const pending = appList.find((a) => a.status === "pending") || null;
          setPendingApproval(pending);

          if (evList.length > 0) {
            lastSeqRef.current = Math.max(
              ...evList.map((e) => e.sequence || 0),
            );
          }
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      }
    }

    fetchSessionData();

    // B. Real-Time SSE Stream
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
        // heartbeat
      }
    };

    const eventTypes = [
      "session.started",
      "session.ended",
      "agent.message",
      "policy.evaluated",
      "approval.requested",
      "approval.resolved",
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

    // C. Active Live Fallback Polling (polls every 1000ms while session is active)
    const pollInterval = setInterval(async () => {
      if (!isMounted) return;
      try {
        const resEvents = await fetch(
          `${serverBase}/sessions/${activeSessionId}/events?afterSeq=${lastSeqRef.current}`,
        );
        if (resEvents.ok) {
          const data = await resEvents.json();
          const newEvents: AgentEvent[] = data.events || [];
          for (const ev of newEvents) {
            handleIncomingEvent(ev);
          }
        }

        const resSession = await fetch(
          `${serverBase}/sessions/${activeSessionId}`,
        );
        if (resSession.ok) {
          const sData = await resSession.json();
          if (sData.session) {
            setSession(sData.session);
          }
        }

        const resApprovals = await fetch(
          `${serverBase}/sessions/${activeSessionId}/approvals`,
        );
        if (resApprovals.ok) {
          const appData = await resApprovals.json();
          const appList: ApprovalRequest[] = appData.approvals || [];
          setApprovals(appList);
          const pending = appList.find((a) => a.status === "pending") || null;
          setPendingApproval(pending);
        }
      } catch {
        // ignore
      }
    }, 1000);

    function handleIncomingEvent(event: AgentEvent) {
      if (!isMounted) return;

      if (event.sequence && event.sequence > lastSeqRef.current) {
        lastSeqRef.current = event.sequence;
      }

      setEvents((prev) => {
        if (
          prev.some(
            (p) =>
              p.id === event.id ||
              (event.sequence && p.sequence === event.sequence),
          )
        ) {
          return prev;
        }
        return [...prev, event];
      });

      if (event.type === "session.started") {
        setSession((prev) => ({
          ...(prev || ({} as any)),
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
        }));
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
      } else if (event.type === "approval.requested") {
        const appReq: ApprovalRequest = {
          id: event.approvalId,
          actionId: event.actionId,
          sessionId: event.sessionId,
          actionKind: event.actionKind,
          category: event.category,
          params: event.params,
          risk: event.risk,
          reason: event.reason,
          matchedPolicies: event.matchedPolicies,
          status: "pending",
          createdAt: event.timestamp,
        };
        setApprovals((prev) => [
          ...prev.filter((a) => a.id !== event.approvalId),
          appReq,
        ]);
        setPendingApproval(appReq);
      } else if (event.type === "approval.resolved") {
        setApprovals((prev) =>
          prev.map((a) =>
            a.id === event.approvalId
              ? {
                  ...a,
                  status: event.decision,
                  resolvedBy: event.resolvedBy,
                  resolvedAt: event.timestamp,
                }
              : a,
          ),
        );
        setPendingApproval((prev) =>
          prev?.id === event.approvalId ? null : prev,
        );
      } else if (event.type === "control.kill_switch_enabled") {
        setSession((prev) => (prev ? { ...prev, status: "killed" } : null));
      } else if (event.type === "control.kill_switch_disabled") {
        setSession((prev) => (prev ? { ...prev, status: "running" } : null));
      }

      setActions((prev) => updateActionList(prev, event));
    }

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      es.close();
      eventSourceRef.current = null;
    };
  }, [activeSessionId, serverBase]);

  const approve = useCallback(
    async (approvalId: string) => {
      try {
        const res = await fetch(
          `${serverBase}/approvals/${approvalId}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolvedBy: "user_browser" }),
          },
        );
        if (res.ok) {
          const data = await res.json();
          setPendingApproval((prev) => (prev?.id === approvalId ? null : prev));
          setApprovals((prev) =>
            prev.map((a) => (a.id === approvalId ? data.approval : a)),
          );
        }
      } catch (err) {
        console.error("Failed to approve request:", err);
      }
    },
    [serverBase],
  );

  const deny = useCallback(
    async (approvalId: string) => {
      try {
        const res = await fetch(`${serverBase}/approvals/${approvalId}/deny`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolvedBy: "user_browser" }),
        });
        if (res.ok) {
          const data = await res.json();
          setPendingApproval((prev) => (prev?.id === approvalId ? null : prev));
          setApprovals((prev) =>
            prev.map((a) => (a.id === approvalId ? data.approval : a)),
          );
        }
      } catch (err) {
        console.error("Failed to deny request:", err);
      }
    },
    [serverBase],
  );

  const killSession = useCallback(
    async (
      reason: string = "Operator activated kill switch via web dashboard",
    ) => {
      if (!session) return;
      try {
        const res = await fetch(`${serverBase}/sessions/${session.id}/kill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, activatedBy: "web_operator" }),
        });
        if (res.ok) {
          setSession((prev) => (prev ? { ...prev, status: "killed" } : null));
        }
      } catch (err) {
        console.error("Failed to trigger kill switch:", err);
      }
    },
    [session, serverBase],
  );

  const resumeSession = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`${serverBase}/sessions/${session.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumedBy: "web_operator" }),
      });
      if (res.ok) {
        setSession((prev) => (prev ? { ...prev, status: "running" } : null));
      }
    } catch (err) {
      console.error("Failed to resume session:", err);
    }
  }, [session, serverBase]);

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
    if (event.type === "policy.evaluated") {
      const existing = current.find((a) => a.actionId === event.actionId);
      if (existing) {
        return current.map((a) =>
          a.actionId === event.actionId
            ? { ...a, policyReason: event.reason }
            : a,
        );
      }
      return current;
    }

    if (event.type === "approval.requested") {
      const item: ActionItem = {
        actionId: event.actionId,
        kind: event.actionKind,
        category: event.category,
        params: event.params,
        status: "waiting_approval",
        startedAt: event.timestamp,
        risk: event.risk,
        approvalId: event.approvalId,
        policyReason: event.reason,
      };
      return [...current.filter((a) => a.actionId !== event.actionId), item];
    }

    if (event.type === "approval.resolved") {
      return current.map((a) => {
        if (a.actionId !== event.actionId && a.approvalId !== event.approvalId)
          return a;
        return {
          ...a,
          status: event.decision === "approved" ? "approved" : "blocked",
        };
      });
    }

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
      const existing = current.find((a) => a.actionId === event.actionId);
      const item: ActionItem = {
        actionId: event.actionId,
        kind: event.kind,
        category: event.category,
        params: event.params as Record<string, any>,
        status: "blocked",
        startedAt: existing ? existing.startedAt : event.timestamp,
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
    approvals,
    pendingApproval,
    approve,
    deny,
    isConnected,
    error,
    allSessions,
    killSession,
    resumeSession,
  };
}
