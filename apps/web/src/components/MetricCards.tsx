'use client';

import React from 'react';
import { ActionItem } from '@/hooks/useSessionStream';
import { FileText, FileEdit, Terminal, AlertTriangle, ShieldCheck } from 'lucide-react';

interface MetricCardsProps {
  actions: ActionItem[];
  activeFilter?: string | null;
  onSelectFilter?: (filter: string | null) => void;
}

export function MetricCards({ actions, activeFilter, onSelectFilter }: MetricCardsProps) {
  const filesRead = actions.filter((a) => a.kind === 'file.read' && a.status === 'completed').length;
  const filesWritten = actions.filter((a) => a.kind === 'file.write' && a.status === 'completed').length;
  const commandsRun = actions.filter((a) => a.kind === 'process.exec' && a.status === 'completed').length;
  const errorsCount = actions.filter((a) => a.status === 'failed' || a.status === 'blocked').length;

  const cards = [
    {
      id: 'file.read',
      label: 'Files Read',
      value: filesRead,
      icon: FileText,
      accentColor: 'text-charcoal',
    },
    {
      id: 'file.write',
      label: 'Files Written',
      value: filesWritten,
      icon: FileEdit,
      accentColor: 'text-charcoal',
    },
    {
      id: 'process.exec',
      label: 'Commands Run',
      value: commandsRun,
      icon: Terminal,
      accentColor: 'text-charcoal',
    },
    {
      id: 'error',
      label: 'Errors / Blocked',
      value: errorsCount,
      icon: errorsCount > 0 ? AlertTriangle : ShieldCheck,
      accentColor: errorsCount > 0 ? 'text-tangerine' : 'text-charcoal-muted',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 pt-4 pb-1">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = activeFilter === c.id;

        return (
          <button
            key={c.id}
            onClick={() => onSelectFilter && onSelectFilter(isActive ? null : c.id)}
            className={`text-left p-3.5 rounded bg-white transition-all flex items-center justify-between border ${
              isActive
                ? 'border-2 border-tangerine bg-tangerine-light shadow-sm'
                : 'border-surface-border hover:border-charcoal hover:bg-surface-muted shadow-xs'
            }`}
          >
            <div>
              <p className="text-[11px] font-bold text-charcoal-muted uppercase tracking-wider">
                {c.label}
              </p>
              <p className="text-2xl font-black text-charcoal mt-0.5 font-mono tracking-tight">
                {c.value}
              </p>
            </div>
            <div
              className={`p-2 rounded border ${
                isActive
                  ? 'bg-tangerine text-white border-tangerine'
                  : 'bg-surface-muted text-charcoal border-surface-border'
              }`}
            >
              <Icon className="w-4 h-4" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
