'use client';

import React from 'react';
import { ActionItem } from '@/hooks/useSessionStream';
import { FileText, FileEdit, Terminal, AlertTriangle } from 'lucide-react';

interface MetricCardsProps {
  actions: ActionItem[];
}

export function MetricCards({ actions }: MetricCardsProps) {
  const filesRead = actions.filter((a) => a.kind === 'file.read' && a.status === 'completed').length;
  const filesWritten = actions.filter((a) => a.kind === 'file.write' && a.status === 'completed').length;
  const commandsRun = actions.filter((a) => a.kind === 'process.exec' && a.status === 'completed').length;
  const errorsCount = actions.filter((a) => a.status === 'failed' || a.status === 'blocked').length;

  const cards = [
    {
      label: 'Files Read',
      value: filesRead,
      icon: FileText,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10 border-blue-500/20',
    },
    {
      label: 'Files Written',
      value: filesWritten,
      icon: FileEdit,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'Commands Run',
      value: commandsRun,
      icon: Terminal,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10 border-cyan-500/20',
    },
    {
      label: 'Errors / Blocked',
      value: errorsCount,
      icon: AlertTriangle,
      color: errorsCount > 0 ? 'text-rose-400' : 'text-slate-400',
      bg: errorsCount > 0 ? 'bg-rose-500/10 border-rose-500/20' : 'bg-surface-elevated border-surface-border',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-6 pb-2">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className={`p-4 rounded-xl border flex items-center justify-between ${c.bg}`}
          >
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{c.label}</p>
              <p className="text-2xl font-bold text-white mt-1 font-mono">{c.value}</p>
            </div>
            <div className={`p-2.5 rounded-lg bg-surface/60 ${c.color}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
