"use client";

import React, { useState } from "react";
import { AgentSession, AgentEvent } from "@agent-monitor/core";
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
} from "lucide-react";

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

  const liveUsage = React.useMemo(() => {
    if (session?.summary?.usage) return session.summary.usage;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let cacheHitTokens = 0;
    let cacheMissTokens = 0;
    let estimatedCostUsd = 0;

    for (const ev of events) {
      if (ev.type === "agent.message" && (ev as any).usage) {
        const u = (ev as any).usage;
        promptTokens += u.promptTokens || 0;
        completionTokens += u.completionTokens || 0;
        totalTokens += u.totalTokens || u.promptTokens + u.completionTokens;
        cacheHitTokens += u.cacheHitTokens || 0;
        cacheMissTokens += u.cacheMissTokens || 0;
        estimatedCostUsd += u.estimatedCostUsd || 0;
      }
    }

    if (totalTokens === 0) return null;
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      cacheHitTokens,
      cacheMissTokens,
      estimatedCostUsd,
    };
  }, [session?.summary?.usage, events]);

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
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-monitor-${session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getRiskBadge = () => {
    if (riskScore >= 60) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span className="hidden sm:inline">Risk:</span>
          <strong>{riskScore}/100</strong>
          <span className="hidden sm:inline">Critical</span>
        </div>
      );
    }
    if (riskScore >= 40) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-terracotta-light text-terracotta border border-terracotta-border">
          <ShieldAlert className="w-3.5 h-3.5 text-terracotta shrink-0" />
          <span className="hidden sm:inline">Risk:</span>
          <strong>{riskScore}/100</strong>
          <span className="hidden sm:inline">High</span>
        </div>
      );
    }
    if (riskScore >= 20) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="hidden sm:inline">Risk:</span>
          <strong>{riskScore}/100</strong>
          <span className="hidden sm:inline">Medium</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="hidden sm:inline">Risk:</span>
        <strong>{riskScore}/100</strong>
        <span className="hidden sm:inline">Low</span>
      </div>
    );
  };

  const getStatusBadge = () => {
    if (!session) {
      return (
        <span className="px-2.5 py-1 rounded text-xs font-semibold bg-alabaster-muted text-ink-muted border border-alabaster-border">
          IDLE
        </span>
      );
    }
    if (session.status === "running") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-terracotta text-white uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
          RUNNING
        </span>
      );
    }
    if (session.status === "completed") {
      return (
        <span className="px-2.5 py-1 rounded text-xs font-bold bg-ink text-white uppercase tracking-wider">
          COMPLETED
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded text-xs font-bold bg-rose-600 text-white uppercase tracking-wider">
        FAILED
      </span>
    );
  };

  const formatRuntime = () => {
    if (!session) return "00:00";
    const end = session.endedAt || Date.now();
    const sec = Math.floor((end - session.startedAt) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <header className="sticky top-0 z-30 border-b border-alabaster-border bg-white px-4 sm:px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand and Session Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-ink flex items-center justify-center text-terracotta shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black tracking-tight text-ink uppercase">
                  AGENT MONITOR
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border">
                  V0.2
                </span>
              </div>
            </div>
          </div>

          <div className="h-5 w-[1px] bg-alabaster-border hidden md:block" />

          {/* Session Switcher Dropdown */}
          {allSessions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 text-xs font-semibold bg-alabaster hover:bg-alabaster-muted text-ink px-2.5 sm:px-3 py-1.5 rounded border border-ink/40 transition-colors max-w-[200px] sm:max-w-[280px] truncate"
              >
                <Cpu className="w-3.5 h-3.5 text-terracotta shrink-0" />
                <span className="truncate">
                  {session
                    ? `${session.id.slice(0, 8)}... — ${session.task.slice(0, 16)}...`
                    : "Select Session"}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-ink-muted shrink-0 ml-auto" />
              </button>

              {isDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsDropdownOpen(false)}
                  />
                  <div className="absolute left-0 mt-1.5 w-72 sm:w-80 bg-white border border-ink/40 rounded shadow-xl py-1 z-50 overflow-hidden divide-y divide-alabaster-border">
                    <div className="px-3 py-2 text-[11px] font-bold text-ink-muted uppercase tracking-wider bg-alabaster-muted">
                      Sessions ({allSessions.length})
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {allSessions.map((s) => {
                        const isCurrent =
                          s.id === (selectedSessionId || session?.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              onSelectSession(s.id);
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3.5 py-2.5 text-xs transition-colors flex flex-col gap-1 hover:bg-alabaster-muted ${
                              isCurrent
                                ? "bg-terracotta-light border-l-4 border-terracotta font-semibold"
                                : ""
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-ink font-bold truncate">
                                {s.id.slice(0, 14)}...
                              </span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                  s.status === "running"
                                    ? "text-terracotta bg-terracotta-light"
                                    : "text-ink-muted bg-alabaster-muted"
                                }`}
                              >
                                {s.status}
                              </span>
                            </div>
                            <span className="text-[11px] text-ink-muted truncate font-medium">
                              {s.task}
                            </span>
                            <span className="text-[10px] text-ink-faint font-mono">
                              {new Date(s.startedAt).toLocaleTimeString()} •{" "}
                              {s.model}
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

        {/* Right: Actions, Clock, Risk & Live Stream */}
        <div className="flex items-center gap-2 sm:gap-3 ml-auto">
          {session && (
            <div className="hidden lg:flex items-center gap-1.5 text-xs">
              <button
                onClick={handleCopyId}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white hover:bg-alabaster-muted text-ink border border-alabaster-border text-[11px] font-mono font-medium transition-colors"
                title="Copy Session ID"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-600" />
                ) : (
                  <Copy className="w-3 h-3 text-ink-muted" />
                )}
                <span>{session.id.slice(0, 10)}</span>
              </button>

              <button
                onClick={handleExportJson}
                className="p-1.5 rounded bg-white hover:bg-alabaster-muted text-ink border border-alabaster-border transition-colors"
                title="Export Session JSON"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {liveUsage && (
            <div
              className="hidden md:flex items-center gap-1.5 text-xs bg-alabaster-muted px-2.5 py-1 rounded border border-alabaster-border font-mono text-ink"
              title={`Input: ${liveUsage.promptTokens.toLocaleString()} (${liveUsage.cacheHitTokens?.toLocaleString() || 0} cached) | Output: ${liveUsage.completionTokens.toLocaleString()}`}
            >
              <span className="text-ink-muted text-[11px] font-bold">
                TOKENS:
              </span>
              <span className="font-bold">
                {liveUsage.totalTokens.toLocaleString()}
              </span>
              <span className="text-stone-300">•</span>
              <span className="text-emerald-700 font-bold">
                {liveUsage.estimatedCostUsd < 0.01
                  ? `$${liveUsage.estimatedCostUsd.toFixed(5)}`
                  : `$${liveUsage.estimatedCostUsd.toFixed(3)}`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-ink bg-alabaster-muted px-2.5 py-1 rounded border border-alabaster-border font-mono font-semibold">
            <Clock className="w-3 h-3 text-ink-muted" />
            <span>{formatRuntime()}</span>
          </div>

          {getStatusBadge()}
          {getRiskBadge()}

          <div
            className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded border transition-colors ${
              isConnected
                ? "bg-terracotta-light text-terracotta border-terracotta-border"
                : "bg-alabaster-muted text-ink-muted border-alabaster-border"
            }`}
            title={
              isConnected
                ? "Real-time SSE Stream Active"
                : "Disconnected / SQLite Polling"
            }
          >
            {isConnected ? (
              <Wifi className="w-3 h-3 text-terracotta" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            <span className="hidden sm:inline uppercase">
              {isConnected ? "Live" : "Offline"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
