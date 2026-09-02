'use client';

import React, { useState } from 'react';
import { AgentSession, AgentEvent } from '@agent-monitor/core';
import {
  Activity,
  ShieldAlert,
  ShieldCheck,
  Clock,
  ChevronDown,
  Copy,
  Check,
  Download,
  Wifi,
  WifiOff,
  Cpu,
} from 'lucide-react';

interface HeaderProps {
  session: AgentSession | null;
  isConnected: boolean;
  allSessions: AgentSession[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  events?: AgentEvent[];
}

export function Header({
  session,
  isConnected,
  allSessions,
  selectedSessionId,
  onSelectSession,
  events = [],
}: HeaderProps) {
  const [copied, setCopied] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const riskScore = session?.riskScore || 0;

  const handleCopyId = () => {
    if (session?.id) {
      navigator.clipboard.writeText(session.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportJson = () => {
    if (!session) return;
    const exportData = {
      session,
      events,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-monitor-${session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getRiskBadge = () => {
    if (riskScore >= 60) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
          <span>Risk: <strong className="font-bold">{riskScore}/100</strong> Critical</span>
        </div>
      );
    }
    if (riskScore >= 40) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-tangerine-light text-tangerine border border-tangerine-border">
          <ShieldAlert className="w-3.5 h-3.5 text-tangerine" />
          <span>Risk: <strong className="font-bold">{riskScore}/100</strong> High</span>
        </div>
      );
    }
    if (riskScore >= 20) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
          <span>Risk: <strong className="font-bold">{riskScore}/100</strong> Medium</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        <span>Risk: <strong className="font-bold">{riskScore}/100</strong> Low</span>
      </div>
    );
  };

  const getStatusBadge = () => {
    if (!session) {
      return (
        <span className="px-2.5 py-1 rounded text-xs font-semibold bg-surface-elevated text-charcoal-muted border border-surface-border">
          IDLE
        </span>
      );
    }
    if (session.status === 'running') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold bg-tangerine text-white uppercase tracking-wider shadow-sm">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
          RUNNING
        </span>
      );
    }
    if (session.status === 'completed') {
      return (
        <span className="px-3 py-1 rounded text-xs font-bold bg-charcoal text-white uppercase tracking-wider">
          COMPLETED
        </span>
      );
    }
    return (
      <span className="px-3 py-1 rounded text-xs font-bold bg-rose-600 text-white uppercase tracking-wider">
        FAILED
      </span>
    );
  };

  const formatRuntime = () => {
    if (!session) return '00:00';
    const end = session.endedAt || Date.now();
    const sec = Math.floor((end - session.startedAt) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-white px-6 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left Brand and Session Dropdown */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-charcoal flex items-center justify-center text-tangerine">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black tracking-tight text-charcoal uppercase">
                  AGENT MONITOR
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-surface-elevated text-charcoal border border-surface-border">
                  V0.1
                </span>
              </div>
            </div>
          </div>

          <div className="h-5 w-[1px] bg-surface-border hidden sm:block" />

          {/* Session Switcher */}
          {allSessions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 text-xs font-semibold bg-white hover:bg-surface-muted text-charcoal px-3 py-1.5 rounded border border-charcoal transition-colors max-w-[280px] truncate shadow-sm"
              >
                <Cpu className="w-3.5 h-3.5 text-tangerine shrink-0" />
                <span className="truncate">
                  {session ? `${session.id.slice(0, 10)}... — ${session.task.slice(0, 20)}...` : 'Select Session'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-charcoal-muted shrink-0 ml-auto" />
              </button>

              {isDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsDropdownOpen(false)}
                  />
                  <div className="absolute left-0 mt-1.5 w-80 bg-white border-2 border-charcoal rounded shadow-xl py-1 z-50 overflow-hidden divide-y divide-surface-border">
                    <div className="px-3 py-2 text-[11px] font-bold text-charcoal-muted uppercase tracking-wider bg-surface-muted">
                      Sessions ({allSessions.length})
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {allSessions.map((s) => {
                        const isCurrent = s.id === (selectedSessionId || session?.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              onSelectSession(s.id);
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3.5 py-2.5 text-xs transition-colors flex flex-col gap-1 hover:bg-surface-muted ${
                              isCurrent ? 'bg-tangerine-light border-l-4 border-tangerine font-semibold' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-charcoal font-bold truncate">
                                {s.id.slice(0, 14)}...
                              </span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                  s.status === 'running'
                                    ? 'text-tangerine bg-tangerine-light'
                                    : 'text-charcoal-muted bg-surface-elevated'
                                }`}
                              >
                                {s.status}
                              </span>
                            </div>
                            <span className="text-[11px] text-charcoal-muted truncate font-medium">{s.task}</span>
                            <span className="text-[10px] text-charcoal-faint font-mono">
                              {new Date(s.startedAt).toLocaleTimeString()} • {s.model}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right Status, Clock, Risk & Actions */}
        <div className="flex items-center gap-3">
          {session && (
            <div className="hidden lg:flex items-center gap-1.5 text-xs">
              <button
                onClick={handleCopyId}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white hover:bg-surface-muted text-charcoal border border-surface-border text-[11px] font-mono font-medium transition-colors shadow-sm"
                title="Copy Session ID"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-charcoal-muted" />}
                <span>{session.id.slice(0, 12)}</span>
              </button>

              <button
                onClick={handleExportJson}
                className="p-1.5 rounded bg-white hover:bg-surface-muted text-charcoal border border-surface-border transition-colors shadow-sm"
                title="Export Session JSON"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-charcoal bg-surface-muted px-2.5 py-1 rounded border border-surface-border font-mono font-semibold">
            <Clock className="w-3 h-3 text-charcoal-muted" />
            <span>{formatRuntime()}</span>
          </div>

          {getStatusBadge()}
          {getRiskBadge()}

          <div
            className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded border transition-colors ${
              isConnected
                ? 'bg-tangerine-light text-tangerine border-tangerine-border'
                : 'bg-surface-muted text-charcoal-muted border-surface-border'
            }`}
            title={isConnected ? 'Real-time SSE Stream Active' : 'Disconnected / SQLite Polling'}
          >
            {isConnected ? <Wifi className="w-3 h-3 text-tangerine" /> : <WifiOff className="w-3 h-3" />}
            <span className="hidden sm:inline uppercase">{isConnected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
