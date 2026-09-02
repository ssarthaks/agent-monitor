'use client';

import React, { useState } from 'react';
import { ActionItem } from '@/hooks/useSessionStream';
import {
  ShieldAlert,
  Terminal,
  FileCode,
  Layers,
  Code,
} from 'lucide-react';

interface InspectorProps {
  action: ActionItem | null;
}

export function Inspector({ action }: InspectorProps) {
  const [viewRaw, setViewRaw] = useState(false);

  if (!action) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface rounded-xl border border-surface-border p-8 text-center text-slate-500">
        <Layers className="w-10 h-10 mb-3 text-slate-600 stroke-[1.5]" />
        <p className="text-sm font-medium text-slate-400">Action Inspector</p>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Select any action from the activity timeline to inspect parameters, diffs, terminal output, and security risk details.
        </p>
      </div>
    );
  }

  const renderDiff = (diffText?: string) => {
    if (!diffText) {
      return (
        <div className="p-4 text-xs text-slate-500 font-mono">No diff available for this write.</div>
      );
    }

    const lines = diffText.split('\n');
    return (
      <div className="font-mono text-xs overflow-x-auto bg-[#060a12] p-3 rounded-lg border border-surface-border">
        {lines.map((line, idx) => {
          let lineClass = 'text-slate-400';
          let bgClass = '';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineClass = 'text-emerald-400';
            bgClass = 'bg-emerald-500/10';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineClass = 'text-rose-400';
            bgClass = 'bg-rose-500/10';
          } else if (line.startsWith('@@')) {
            lineClass = 'text-cyan-400 font-semibold';
            bgClass = 'bg-cyan-500/10';
          }

          return (
            <div key={idx} className={`px-2 py-0.5 rounded-sm flex gap-3 ${bgClass}`}>
              <span className="text-slate-600 select-none w-6 text-right shrink-0">{idx + 1}</span>
              <span className={`${lineClass} whitespace-pre`}>{line}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderTerminal = (result?: any) => {
    if (!result) return <div className="text-xs text-slate-500">No output recorded.</div>;
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const exitCode = result.exitCode;

    return (
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-surface-elevated px-3 py-2 rounded-lg border border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-cyan-300">
            <span className="text-slate-500">$</span>
            <span className="font-semibold">{action.params.command}</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              exitCode === 0
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            }`}
          >
            exit {exitCode !== null ? exitCode : 'null'}
          </span>
        </div>

        <div className="bg-[#050811] p-3 rounded-lg border border-surface-border text-slate-300 overflow-x-auto max-h-80 whitespace-pre-wrap">
          {stdout && <div className="text-emerald-300/90">{stdout}</div>}
          {stderr && <div className="text-rose-400/90 mt-2">{stderr}</div>}
          {!stdout && !stderr && <div className="text-slate-600 italic">No output received</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface rounded-xl border border-surface-border overflow-hidden">
      <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between bg-surface-elevated/40">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
            {action.kind}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-elevated text-slate-400 border border-surface-border">
            {action.actionId}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewRaw(!viewRaw)}
            className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
              viewRaw
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-border'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            {viewRaw ? 'Visual View' : 'Raw JSON'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {action.risk && action.risk.flags.length > 0 && (
          <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 text-xs font-bold text-red-400 mb-2">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              Security Risk Detected: {action.risk.level} ({action.risk.score}/100)
            </div>
            <div className="space-y-1.5">
              {action.risk.flags.map((flag, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                  <span className="font-mono text-red-400 font-semibold shrink-0">
                    [{flag.ruleId}]
                  </span>
                  <span>{flag.description}</span>
                  <span className="text-red-400/80 font-mono text-[10px] ml-auto shrink-0">
                    +{flag.scoreImpact} pts
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {action.status === 'blocked' && (
          <div className="p-3.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 text-xs">
            <strong>ACTION BLOCKED BY SECURITY GUARDRAIL:</strong>
            <p className="mt-1 font-mono text-red-300">{action.reason}</p>
          </div>
        )}

        {action.status === 'failed' && action.error && (
          <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            <strong>Execution Error:</strong>
            <p className="mt-1 font-mono">{action.error.message}</p>
          </div>
        )}

        {viewRaw ? (
          <div className="font-mono text-xs bg-[#060a12] p-3 rounded-lg border border-surface-border text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(action, null, 2)}
          </div>
        ) : (
          <>
            {action.kind === 'file.write' && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                  File Diff: {action.params.path}
                </h3>
                {renderDiff(action.metadata?.diff || action.result?.diff)}
              </div>
            )}

            {action.kind === 'process.exec' && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  Command Execution
                </h3>
                {renderTerminal(action.result)}
              </div>
            )}

            {action.kind === 'file.read' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-blue-400" />
                  File Read: {action.params.path}
                </h3>
                {action.result && (
                  <div className="font-mono text-xs bg-[#060a12] p-3 rounded-lg border border-surface-border text-slate-300 overflow-x-auto max-h-80 whitespace-pre-wrap">
                    {action.result.content}
                  </div>
                )}
              </div>
            )}

            {action.kind === 'file.list' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Directory Entries ({action.result?.totalCount || 0})
                </h3>
                {action.result?.entries && (
                  <div className="bg-[#060a12] p-2 rounded-lg border border-surface-border max-h-80 overflow-y-auto divide-y divide-surface-border/30 font-mono text-xs">
                    {action.result.entries.map((entry: any, i: number) => (
                      <div key={i} className="py-1 px-2 flex items-center justify-between text-slate-300">
                        <span>{entry.path}</span>
                        <span className="text-[10px] text-slate-500 uppercase">{entry.type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
