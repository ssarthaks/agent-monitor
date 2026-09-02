'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSessionStream, ActionItem } from '@/hooks/useSessionStream';
import { Header } from '@/components/Header';
import { MetricCards } from '@/components/MetricCards';
import { Timeline } from '@/components/Timeline';
import { Inspector } from '@/components/Inspector';
import {
  MessageSquare,
  Bot,
  Terminal,
  Copy,
  Check,
  Sparkles,
  Shield,
  Activity,
} from 'lucide-react';

function DashboardContent() {
  const searchParams = useSearchParams();
  const querySessionId = searchParams.get('sessionId');

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(querySessionId);
  const [selectedAction, setSelectedAction] = useState<ActionItem | null>(null);
  const [activeMetricFilter, setActiveMetricFilter] = useState<string | null>(null);
  const [copiedCli, setCopiedCli] = useState(false);

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
  }, [actions.length, selectedAction]);

  const agentMessages = events.filter((e) => e.type === 'agent.message');
  const latestMessage = agentMessages.length > 0 ? (agentMessages[agentMessages.length - 1] as any).content : null;

  const handleCopyCli = () => {
    navigator.clipboard.writeText('npm run cli -- run --task "Inspect this project and run tests"');
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <div className="flex flex-col min-h-screen bg-white text-charcoal">
      <Header
        session={session}
        isConnected={isConnected}
        allSessions={allSessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={(id) => {
          setSelectedSessionId(id);
          setSelectedAction(null);
        }}
        events={events}
      />

      {error && (
        <div className="mx-6 mt-3 p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between">
          <span className="font-semibold">⚠️ Backend offline: {error} (Ensure monitor server is running on port 4040)</span>
          <span className="font-mono text-[11px] font-bold text-rose-700 bg-white px-2 py-0.5 rounded border border-rose-200">
            npm run cli -- run
          </span>
        </div>
      )}

      {/* Metric summary counters */}
      <MetricCards
        actions={actions}
        activeFilter={activeMetricFilter}
        onSelectFilter={setActiveMetricFilter}
      />

      {/* Welcome Screen or Live Timeline/Inspector */}
      {!session && actions.length === 0 ? (
        <div className="flex-1 px-6 py-10 flex items-center justify-center">
          <div className="max-w-xl w-full text-center space-y-6 p-8 rounded bg-white border-2 border-charcoal shadow-sm">
            <div className="w-14 h-14 rounded bg-charcoal text-tangerine flex items-center justify-center mx-auto shadow-sm">
              <Activity className="w-7 h-7" />
            </div>

            <div>
              <h2 className="text-xl font-black text-charcoal tracking-tight uppercase">
                AGENT MONITOR CONTROL PLANE
              </h2>
              <p className="text-xs text-charcoal-muted mt-1.5 leading-relaxed font-medium">
                Pure, real-time observability, timeline inspection, file diffs, and deterministic risk analysis for autonomous coding agents.
              </p>
            </div>

            <div className="p-4 rounded bg-surface-muted border border-surface-border text-left space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-charcoal uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-tangerine" />
                  Quick Start CLI Command
                </span>
                <button
                  onClick={handleCopyCli}
                  className="flex items-center gap-1 text-tangerine hover:text-tangerine-hover font-bold transition-colors"
                >
                  {copiedCli ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCli ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <code className="block font-mono text-xs text-white bg-charcoal p-3 rounded overflow-x-auto border border-charcoal font-semibold">
                npm run cli -- run --task "Inspect this project and run tests"
              </code>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2 text-left">
              <div className="p-3 rounded bg-surface-muted border border-surface-border">
                <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-tangerine" />
                  Live SSE
                </div>
                <p className="text-[11px] text-charcoal-muted leading-tight font-medium">
                  Real-time event stream from the agent runtime.
                </p>
              </div>

              <div className="p-3 rounded bg-surface-muted border border-surface-border">
                <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal mb-1">
                  <Terminal className="w-3.5 h-3.5 text-tangerine" />
                  Visual Diffs
                </div>
                <p className="text-[11px] text-charcoal-muted leading-tight font-medium">
                  Side-by-side file patches & command output.
                </p>
              </div>

              <div className="p-3 rounded bg-surface-muted border border-surface-border">
                <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal mb-1">
                  <Shield className="w-3.5 h-3.5 text-tangerine" />
                  Risk Engine
                </div>
                <p className="text-[11px] text-charcoal-muted leading-tight font-medium">
                  Flags secrets, keys, and dangerous commands.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Active Task Banner & Latest Assistant Message */}
          {session && (
            <div className="px-6 py-2">
              <div className="p-3 rounded bg-surface-muted border border-surface-border flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="p-1.5 rounded bg-charcoal text-tangerine shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-black text-tangerine uppercase tracking-wider block">
                      ACTIVE TASK OBJECTIVE
                    </span>
                    <p className="text-xs font-bold text-charcoal truncate">
                      {session.task}
                    </p>
                  </div>
                </div>

                {latestMessage && (
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-surface-border text-xs max-w-lg truncate shrink-0 shadow-xs">
                    <MessageSquare className="w-3.5 h-3.5 text-tangerine shrink-0" />
                    <span className="text-charcoal-muted text-[11px] shrink-0 font-bold uppercase">Agent:</span>
                    <span className="text-charcoal font-mono text-[11px] truncate font-medium">
                      {latestMessage}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Activity Timeline (Left) & Action Inspector (Right) */}
          <main className="flex-1 px-6 py-3 grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 h-[calc(100vh-270px)] min-h-[420px]">
              <Timeline
                actions={actions}
                selectedActionId={selectedAction?.actionId || null}
                onSelectAction={setSelectedAction}
                filterCategory={activeMetricFilter}
                onClearCategoryFilter={() => setActiveMetricFilter(null)}
              />
            </div>

            <div className="lg:col-span-7 h-[calc(100vh-270px)] min-h-[420px]">
              <Inspector action={selectedAction} />
            </div>
          </main>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen text-charcoal-muted text-xs font-mono">
          Loading Agent Monitor...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
