'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSessionStream, ActionItem } from '../hooks/useSessionStream.js';
import { Header } from '../components/Header.js';
import { MetricCards } from '../components/MetricCards.js';
import { Timeline } from '../components/Timeline.js';
import { Inspector } from '../components/Inspector.js';
import { MessageSquare, Bot } from 'lucide-react';

function DashboardContent() {
  const searchParams = useSearchParams();
  const querySessionId = searchParams.get('sessionId');

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(querySessionId);
  const [selectedAction, setSelectedAction] = useState<ActionItem | null>(null);

  const {
    session,
    events,
    actions,
    isConnected,
    error,
    allSessions,
  } = useSessionStream(selectedSessionId);

  useEffect(() => {
    if (!selectedAction && actions.length > 0) {
      setSelectedAction(actions[actions.length - 1]);
    }
  }, [actions.length]);

  const agentMessages = events.filter((e) => e.type === 'agent.message');

  return (
    <div className="flex flex-col min-h-screen">
      <Header
        session={session}
        isConnected={isConnected}
        allSessions={allSessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={(id) => {
          setSelectedSessionId(id);
          setSelectedAction(null);
        }}
      />

      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          ⚠️ Server connection error: {error} (Ensure Monitor Server is running on port 4040)
        </div>
      )}

      <MetricCards actions={actions} />

      {session && (
        <div className="px-6 py-2">
          <div className="p-3.5 rounded-xl bg-surface border border-surface-border flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Bot className="w-4 h-4 text-cyan-400" />
              <span>Agent Task:</span>
              <span className="font-normal text-slate-200">{session.task}</span>
            </div>

            {agentMessages.length > 0 && (
              <div className="mt-1 pt-2 border-t border-surface-border/50">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-400 mb-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Latest Message:
                </div>
                <div className="text-xs text-slate-300 font-mono bg-surface-elevated/80 p-2.5 rounded-lg border border-surface-border max-h-24 overflow-y-auto whitespace-pre-wrap">
                  {(agentMessages[agentMessages.length - 1] as any).content}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 h-[calc(100vh-290px)] min-h-[400px]">
          <Timeline
            actions={actions}
            selectedActionId={selectedAction?.actionId || null}
            onSelectAction={setSelectedAction}
          />
        </div>

        <div className="lg:col-span-7 h-[calc(100vh-290px)] min-h-[400px]">
          <Inspector action={selectedAction} />
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen text-slate-400 text-xs">
          Loading Agent Monitor...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
