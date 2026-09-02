'use client';

import React, { useState, useMemo } from 'react';
import { ActionItem } from '@/hooks/useSessionStream';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

interface TimelineProps {
  actions: ActionItem[];
  selectedActionId: string | null;
  onSelectAction: (action: ActionItem) => void;
  filterCategory?: string | null;
  onClearCategoryFilter?: () => void;
}

export function Timeline({
  actions,
  selectedActionId,
  onSelectAction,
  filterCategory,
  onClearCategoryFilter,
}: TimelineProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'file' | 'process' | 'error' | 'high_risk'>('all');

  const filteredActions = useMemo(() => {
    return actions.filter((action) => {
      // 1. Metric card category filter
      if (filterCategory) {
        if (filterCategory === 'error') {
          if (action.status !== 'failed' && action.status !== 'blocked') return false;
        } else if (action.kind !== filterCategory) {
          return false;
        }
      }

      // 2. Tab filter
      if (activeTab === 'file' && !action.kind.startsWith('file.')) return false;
      if (activeTab === 'process' && action.kind !== 'process.exec') return false;
      if (activeTab === 'error' && action.status !== 'failed' && action.status !== 'blocked') return false;
      if (activeTab === 'high_risk') {
        const score = action.risk?.score || 0;
        if (score < 40) return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const target = (action.params.path || action.params.command || '').toLowerCase();
        const kind = action.kind.toLowerCase();
        const reason = (action.reason || '').toLowerCase();
        return target.includes(q) || kind.includes(q) || reason.includes(q);
      }

      return true;
    });
  }, [actions, filterCategory, activeTab, searchQuery]);

  const getMethodBadge = (kind: string) => {
    switch (kind) {
      case 'file.read':
        return (
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border">
            READ
          </span>
        );
      case 'file.write':
        return (
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border">
            WRITE
          </span>
        );
      case 'file.list':
        return (
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border">
            LIST
          </span>
        );
      case 'process.exec':
        return (
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-ink text-white">
            EXEC
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-alabaster-muted text-ink-muted border border-alabaster-border">
            ACTION
          </span>
        );
    }
  };

  const getStatusIcon = (action: ActionItem) => {
    if (action.status === 'blocked') {
      return <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
    }
    if (action.status === 'failed') {
      return <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
    }
    if (action.status === 'running') {
      return <Loader2 className="w-3.5 h-3.5 text-terracotta animate-spin shrink-0" />;
    }
    if (action.risk && action.risk.level === 'CRITICAL') {
      return <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
    }
    if (action.risk && action.risk.level === 'HIGH') {
      return <AlertTriangle className="w-3.5 h-3.5 text-terracotta shrink-0" />;
    }
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
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
    <div className="flex flex-col h-full bg-white rounded border border-alabaster-border overflow-hidden">
      {/* Search and Filter bar */}
      <div className="p-3 border-b border-alabaster-border bg-alabaster-muted space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-black uppercase tracking-wider text-ink">
              ACTIVITY STREAM
            </h2>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-white text-ink border border-alabaster-border">
              {filteredActions.length} / {actions.length}
            </span>
          </div>

          {filterCategory && (
            <button
              onClick={onClearCategoryFilter}
              className="flex items-center gap-1 text-[11px] font-bold text-terracotta bg-terracotta-light px-2 py-0.5 rounded border border-terracotta-border hover:bg-terracotta hover:text-white transition-colors"
            >
              <span>{filterCategory}</span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter path, command, or keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white text-xs text-ink placeholder-ink-faint pl-8 pr-7 py-1.5 rounded border border-alabaster-border focus:outline-none focus:border-ink transition-colors font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px]">
          {[
            { id: 'all', label: 'All' },
            { id: 'file', label: 'Files' },
            { id: 'process', label: 'Commands' },
            { id: 'error', label: 'Errors' },
            { id: 'high_risk', label: 'High Risk' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-2.5 py-0.5 rounded font-bold transition-colors whitespace-nowrap uppercase tracking-wider text-[10px] ${
                activeTab === tab.id
                  ? 'bg-ink text-white'
                  : 'bg-white text-ink-muted border border-alabaster-border hover:border-ink hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action Items List */}
      <div className="flex-1 overflow-y-auto divide-y divide-alabaster-border">
        {filteredActions.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-xs flex flex-col items-center justify-center h-48">
            <SlidersHorizontal className="w-8 h-8 mb-2 text-ink-faint stroke-[1.5]" />
            <p className="font-bold text-ink">No matching activities</p>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {searchQuery || activeTab !== 'all'
                ? 'Clear filters or search term to see all actions'
                : 'Waiting for agent to execute operations...'}
            </p>
          </div>
        ) : (
          filteredActions.map((action) => {
            const isSelected = selectedActionId === action.actionId;
            const timeStr = new Date(action.startedAt).toLocaleTimeString();
            const targetStr = formatTarget(action);

            return (
              <button
                key={action.actionId}
                onClick={() => onSelectAction(action)}
                className={`w-full text-left px-3 sm:px-3.5 py-2.5 flex items-center gap-2 sm:gap-2.5 transition-all text-xs group ${
                  isSelected
                    ? 'bg-terracotta-light border-l-4 border-terracotta font-semibold'
                    : 'bg-white hover:bg-alabaster-muted border-l-4 border-transparent'
                }`}
              >
                <span className="text-ink-muted text-[10px] font-mono shrink-0 w-14">
                  {timeStr}
                </span>

                {getStatusIcon(action)}
                {getMethodBadge(action.kind)}

                <span
                  className="text-ink truncate flex-1 font-mono text-[11px] group-hover:text-terracotta transition-colors font-medium"
                  title={targetStr}
                >
                  {targetStr}
                </span>

                {action.risk && action.risk.level !== 'NONE' && (
                  <span
                    className={`shrink-0 px-1.5 py-0.2 rounded text-[10px] font-black font-mono ${
                      action.risk.level === 'CRITICAL'
                        ? 'bg-rose-100 text-rose-700 border border-rose-200'
                        : action.risk.level === 'HIGH'
                        ? 'bg-terracotta-light text-terracotta border border-terracotta-border'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {action.risk.score}
                  </span>
                )}

                {action.durationMs !== undefined && (
                  <span className="text-ink-faint text-[10px] font-mono shrink-0 hidden sm:inline">
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
