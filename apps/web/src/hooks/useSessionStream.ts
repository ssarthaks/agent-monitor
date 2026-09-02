'use client';

import { useState, useEffect, useRef } from 'react';
import {
  AgentEvent,
  AgentSession,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionFailedEvent,
  ActionBlockedEvent,
} from '@agent-monitor/core';

export interface ActionItem {
  actionId: string;
  kind: string;
  category: string;
  params: Record<string, any>;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  risk: ActionStartedEvent['risk'];
  result?: any;
  error?: { message: string; code?: string };
  metadata?: ActionCompletedEvent['metadata'];
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
  const lastSeqRef = useRef<number>(0);

  const serverBase =
    typeof window !== 'undefined' &&
    (window.location.port === '4040' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost')
      ? `${window.location.protocol}//${window.location.hostname}:4040`
      : process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:4040';

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
        const [resSession, resEvents] = await Promise.all([
          fetch(`${serverBase}/sessions/${activeSessionId}`),
          fetch(`${serverBase}/sessions/${activeSessionId}/events`),
        ]);

        if (!resSession.ok) throw new Error('Session not found');
        const sessionData = await resSession.json();
        const eventsData = await resEvents.json();

        if (isMounted) {
          setSession(sessionData.session);
          const evList: AgentEvent[] = eventsData.events || [];
          setEvents(evList);
          reconstructActions(evList);
          if (evList.length > 0) {
            lastSeqRef.current = Math.max(...evList.map((e) => e.sequence || 0));
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
        if (msg.data && msg.data.startsWith('{')) {
          const event: AgentEvent = JSON.parse(msg.data);
          handleIncomingEvent(event);
        }
      } catch {
        // heartbeat
      }
    };

    const eventTypes = [
      'session.started',
      'session.ended',
      'agent.message',
      'action.started',
      'action.completed',
      'action.failed',
      'action.blocked',
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
          `${serverBase}/sessions/${activeSessionId}/events?afterSeq=${lastSeqRef.current}`
        );
        if (resEvents.ok) {
          const data = await resEvents.json();
          const newEvents: AgentEvent[] = data.events || [];
          for (const ev of newEvents) {
            handleIncomingEvent(ev);
          }
        }

        // Also refresh session metadata (status, risk, timer)
        const resSession = await fetch(`${serverBase}/sessions/${activeSessionId}`);
        if (resSession.ok) {
          const sData = await resSession.json();
          if (sData.session) {
            setSession(sData.session);
          }
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
        if (prev.some((p) => p.id === event.id || (event.sequence && p.sequence === event.sequence))) {
          return prev;
        }
        return [...prev, event];
      });

      if (event.type === 'session.started') {
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
          status: 'running',
          riskScore: 0,
        }));
      } else if (event.type === 'session.ended') {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: event.status,
                endedAt: event.timestamp,
                summary: event.summary,
                riskScore: event.summary.overallRiskScore,
              }
            : null
        );
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

  function reconstructActions(evList: AgentEvent[]) {
    let list: ActionItem[] = [];
    for (const ev of evList) {
      list = updateActionList(list, ev);
    }
    setActions(list);
  }

  function updateActionList(current: ActionItem[], event: AgentEvent): ActionItem[] {
    if (event.type === 'action.started') {
      const item: ActionItem = {
        actionId: event.actionId,
        kind: event.kind,
        category: event.category,
        params: event.params,
        status: 'running',
        startedAt: event.timestamp,
        risk: event.risk,
      };
      return [...current.filter((a) => a.actionId !== event.actionId), item];
    }

    if (event.type === 'action.completed') {
      return current.map((a) => {
        if (a.actionId !== event.actionId) return a;
        return {
          ...a,
          status: 'completed',
          completedAt: event.timestamp,
          durationMs: event.durationMs,
          result: event.result,
          metadata: event.metadata,
          risk: event.risk || a.risk,
        };
      });
    }

    if (event.type === 'action.failed') {
      return current.map((a) => {
        if (a.actionId !== event.actionId) return a;
        return {
          ...a,
          status: 'failed',
          completedAt: event.timestamp,
          durationMs: event.durationMs,
          error: event.error,
        };
      });
    }

    if (event.type === 'action.blocked') {
      const item: ActionItem = {
        actionId: event.actionId,
        kind: event.kind,
        category: event.category,
        params: event.params,
        status: 'blocked',
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
