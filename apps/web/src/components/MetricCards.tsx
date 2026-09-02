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
    },
    {
      id: 'file.write',
      label: 'Files Written',
      value: filesWritten,
      icon: FileEdit,
    },
    {
      id: 'process.exec',
      label: 'Commands Run',
      value: commandsRun,
      icon: Terminal,
    },
    {
      id: 'error',
      label: 'Errors / Blocked',
      value: errorsCount,
      icon: errorsCount > 0 ? AlertTriangle : ShieldCheck,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 px-4 sm:px-6 pt-3 sm:pt-4 pb-1">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = activeFilter === c.id;

        return (
          <button
            key={c.id}
            onClick={() => onSelectFilter && onSelectFilter(isActive ? null : c.id)}
            className={`text-left p-3 sm:p-3.5 rounded bg-white transition-all flex items-center justify-between border ${
              isActive
                ? 'border-2 border-terracotta bg-terracotta-light'
                : 'border-alabaster-border hover:border-ink/40 hover:bg-alabaster-muted'
            }`}
          >
            <div>
              <p className="text-[10px] sm:text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                {c.label}
              </p>
              <p className="text-xl sm:text-2xl font-black text-ink mt-0.5 font-mono tracking-tight">
                {c.value}
              </p>
            </div>
            <div
              className={`p-1.5 sm:p-2 rounded border ${
                isActive
                  ? 'bg-terracotta text-white border-terracotta'
                  : 'bg-alabaster-muted text-ink border-alabaster-border'
              }`}
            >
              <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
