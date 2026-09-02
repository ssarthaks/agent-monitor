'use client';

import React from 'react';
import { ActionItem } from '@/hooks/useSessionStream';
import {
  FileText,
  FileEdit,
  FolderOpen,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Loader2,
} from 'lucide-react';

interface TimelineProps {
  actions: ActionItem[];
  selectedActionId: string | null;
  onSelectAction: (action: ActionItem) => void;
}

export function Timeline({
  actions,
  selectedActionId,
  onSelectAction,
}: TimelineProps) {
  const getActionIcon = (kind: string) => {
    switch (kind) {
      case 'file.read':
        return <FileText className="w-4 h-4 text-blue-400" />;
      case 'file.write':
        return <FileEdit className="w-4 h-4 text-emerald-400" />;
      case 'file.list':
        return <FolderOpen className="w-4 h-4 text-amber-400" />;
      case 'process.exec':
        return <Terminal className="w-4 h-4 text-cyan-400" />;
      default:
        return <Terminal className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusIcon = (action: ActionItem) => {
    if (action.status === 'blocked') {
      return <ShieldAlert className="w-4 h-4 text-red-400" />;
    }
    if (action.status === 'failed') {
      return <XCircle className="w-4 h-4 text-rose-400" />;
    }
    if (action.status === 'running') {
      return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />;
    }
    if (action.risk && action.risk.level === 'CRITICAL') {
      return <AlertTriangle className="w-4 h-4 text-red-400" />;
    }
    if (action.risk && action.risk.level === 'HIGH') {
      return <AlertTriangle className="w-4 h-4 text-orange-400" />;
    }
    if (action.risk && action.risk.level === 'MEDIUM') {
      return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    }
    return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  };

  const formatTarget = (action: ActionItem) => {
    if (action.kind.startsWith('file.')) {
      return action.params.path || '.';
    }
    if (action.kind === 'process.exec') {
      return action.params.command || '';
    }
    return JSON.stringify(action.params);
  };

  return (
    <div className="flex flex-col h-full bg-surface rounded-xl border border-surface-border overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between bg-surface-elevated/40">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Activity Timeline ({actions.length} actions)
        </h2>
        <span className="text-[11px] text-slate-500 font-mono">Live Stream</span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-surface-border/40">
        {actions.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No agent activity recorded yet. Waiting for actions...
          </div>
        ) : (
          actions.map((action) => {
            const isSelected = selectedActionId === action.actionId;
            const timeStr = new Date(action.startedAt).toLocaleTimeString();
            const targetStr = formatTarget(action);

            return (
              <button
                key={action.actionId}
                onClick={() => onSelectAction(action)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors text-xs font-mono hover:bg-surface-elevated/70 ${
                  isSelected
                    ? 'bg-cyan-500/10 border-l-2 border-cyan-400'
                    : 'border-l-2 border-transparent'
                }`}
              >
                <span className="text-slate-500 text-[11px] shrink-0 w-16">{timeStr}</span>
                <div className="shrink-0">{getStatusIcon(action)}</div>
                <div className="shrink-0">{getActionIcon(action.kind)}</div>

                <span className="font-semibold text-slate-200 shrink-0 w-24 truncate">
                  {action.kind}
                </span>

                <span className="text-slate-300 truncate flex-1 font-normal" title={targetStr}>
                  {targetStr}
                </span>

                {action.risk && action.risk.level !== 'NONE' && (
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      action.risk.level === 'CRITICAL'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : action.risk.level === 'HIGH'
                        ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    }`}
                  >
                    {action.risk.level}
                  </span>
                )}

                {action.durationMs !== undefined && (
                  <span className="text-slate-500 text-[11px] shrink-0">
                    {action.durationMs}ms
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
