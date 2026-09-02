'use client';

import React from 'react';
import { AgentSession } from '@agent-monitor/core';
import { Activity, ShieldAlert, Clock, Server } from 'lucide-react';

interface HeaderProps {
  session: AgentSession | null;
  isConnected: boolean;
  allSessions: AgentSession[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function Header({
  session,
  isConnected,
  allSessions,
  selectedSessionId,
  onSelectSession,
}: HeaderProps) {
  const riskScore = session?.riskScore || 0;

  const getRiskBadge = () => {
    if (riskScore >= 60) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
          <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
          RISK: {riskScore}/100 CRITICAL
        </span>
      );
    }
    if (riskScore >= 40) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
          <ShieldAlert className="w-3.5 h-3.5 text-orange-400" />
          RISK: {riskScore}/100 HIGH
        </span>
      );
    }
    if (riskScore >= 20) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
          <ShieldAlert className="w-3.5 h-3.5 text-yellow-400" />
          RISK: {riskScore}/100 MEDIUM
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        RISK: {riskScore}/100 LOW
      </span>
    );
  };

  const getStatusBadge = () => {
    if (!session) {
      return (
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
          IDLE
        </span>
      );
    }
    if (session.status === 'running') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          RUNNING
        </span>
      );
    }
    if (session.status === 'completed') {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
          COMPLETED
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
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
    <header className="border-b border-surface-border bg-surface px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">AGENT MONITOR</h1>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                v0.1 DevTools
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
              <span>Agent: <strong className="text-slate-200">{session?.agentName || 'DeepSeek Coder'}</strong></span>
              <span className="text-slate-600">•</span>
              <span className="font-mono text-slate-400">{session?.model || 'deepseek-chat'}</span>
            </p>
          </div>
        </div>

        {allSessions.length > 0 && (
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedSessionId || session?.id || ''}
              onChange={(e) => onSelectSession(e.target.value)}
              className="bg-surface-elevated border border-surface-border text-xs rounded-md px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              {allSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id.slice(0, 12)} — {s.task.slice(0, 30)}... ({new Date(s.startedAt).toLocaleTimeString()})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-surface-elevated px-2.5 py-1 rounded-md border border-surface-border">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono">{formatRuntime()}</span>
          </div>

          {getStatusBadge()}
          {getRiskBadge()}

          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400' : 'bg-slate-600'
            }`}
            title={isConnected ? 'SSE Live Stream Active' : 'Offline / Polling SQLite'}
          />
        </div>
      </div>
    </header>
  );
}
