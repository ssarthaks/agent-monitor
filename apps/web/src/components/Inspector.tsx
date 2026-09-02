'use client';

import React, { useState } from 'react';
import { ActionItem } from '@/hooks/useSessionStream';
import {
  ShieldAlert,
  Terminal,
  FileCode,
  Layers,
  Code,
  Copy,
  Check,
  FolderOpen,
  FileText,
  AlertCircle,
} from 'lucide-react';

interface InspectorProps {
  action: ActionItem | null;
}

export function Inspector({ action }: InspectorProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'params' | 'risk' | 'raw'>('preview');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const handleCopy = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  if (!action) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-white rounded border border-alabaster-border p-8 text-center text-ink-muted">
        <div className="w-12 h-12 rounded bg-alabaster-muted flex items-center justify-center mb-3 border border-alabaster-border">
          <Layers className="w-6 h-6 text-ink stroke-[1.5]" />
        </div>
        <p className="text-sm font-bold text-ink uppercase tracking-wide">Action Inspector</p>
        <p className="text-xs text-ink-muted mt-1 max-w-xs leading-relaxed font-medium">
          Select any action from the activity timeline to inspect file diffs, command executions, parameters, and risk details.
        </p>
      </div>
    );
  }

  const renderDiff = (diffText?: string) => {
    if (!diffText) {
      return (
        <div className="p-6 text-center text-xs text-ink-muted font-mono bg-alabaster-muted rounded border border-alabaster-border">
          No diff available for this write operation.
        </div>
      );
    }

    const lines = diffText.split('\n');
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2 text-xs font-mono text-ink font-semibold">
            <span className="text-emerald-700 font-bold">+{lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length}</span>
            <span className="text-rose-700 font-bold">-{lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length}</span>
            <span className="text-ink-muted font-normal">lines changed</span>
          </div>
          <button
            onClick={() => handleCopy(diffText, 'diff')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white hover:bg-alabaster-muted text-ink text-[11px] font-mono font-semibold border border-alabaster-border transition-colors"
          >
            {copiedSection === 'diff' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-ink-muted" />}
            <span>Copy Diff</span>
          </button>
        </div>

        <div className="font-mono text-xs overflow-x-auto bg-ink p-3.5 rounded border border-ink text-slate-200">
          {lines.map((line, idx) => {
            let lineClass = 'text-slate-300';
            let bgClass = '';
            if (line.startsWith('+') && !line.startsWith('+++')) {
              lineClass = 'text-emerald-300 font-medium';
              bgClass = 'bg-emerald-950/40 -mx-3.5 px-3.5 border-l-2 border-emerald-400';
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              lineClass = 'text-rose-300 font-medium';
              bgClass = 'bg-rose-950/40 -mx-3.5 px-3.5 border-l-2 border-rose-400';
            } else if (line.startsWith('@@')) {
              lineClass = 'text-terracotta-hover font-semibold';
              bgClass = 'bg-ink-dark -mx-3.5 px-3.5';
            }

            return (
              <div key={idx} className={`py-0.5 flex gap-3 text-[11px] leading-5 ${bgClass}`}>
                <span className="text-slate-500 select-none w-6 text-right shrink-0 font-mono">
                  {idx + 1}
                </span>
                <span className={`${lineClass} whitespace-pre`}>{line}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTerminal = (result?: any) => {
    const stdout = result?.stdout || '';
    const stderr = result?.stderr || '';
    const exitCode = result?.exitCode;
    const command = action.params.command || '';

    return (
      <div className="space-y-3 font-mono text-xs">
        {/* Command bar */}
        <div className="bg-alabaster-muted px-3.5 py-2 rounded border border-alabaster-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-ink font-bold truncate">
            <span className="text-terracotta font-black">$</span>
            <span className="truncate">{command}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleCopy(command, 'cmd')}
              className="p-1 rounded bg-white hover:bg-alabaster-muted text-ink border border-alabaster-border transition-colors"
              title="Copy Command"
            >
              {copiedSection === 'cmd' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-ink-muted" />}
            </button>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                exitCode === 0
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-100 text-rose-800 border border-rose-200'
              }`}
            >
              exit {exitCode !== null && exitCode !== undefined ? exitCode : 'null'}
            </span>
          </div>
        </div>

        {/* Output console */}
        <div className="bg-ink p-3.5 rounded border border-ink text-slate-200 overflow-x-auto max-h-96 whitespace-pre-wrap font-mono text-xs">
          {stdout && <div className="text-emerald-300 leading-relaxed">{stdout}</div>}
          {stderr && <div className="text-rose-300 mt-2 leading-relaxed">{stderr}</div>}
          {!stdout && !stderr && (
            <div className="text-slate-400 italic">No output produced by this command.</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white rounded border border-alabaster-border overflow-hidden">
      {/* Top action info bar */}
      <div className="px-4 py-3 border-b border-alabaster-border flex flex-wrap items-center justify-between gap-3 bg-alabaster-muted">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-black uppercase tracking-wider text-ink">
            {action.kind}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-ink-muted border border-alabaster-border font-bold">
            {action.actionId}
          </span>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-white p-0.5 rounded border border-alabaster-border text-xs">
          <button
            onClick={() => setActiveTab('preview')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors ${
              activeTab === 'preview'
                ? 'bg-ink text-white'
                : 'text-ink-muted hover:text-ink hover:bg-alabaster-muted'
            }`}
          >
            Output / Diff
          </button>
          <button
            onClick={() => setActiveTab('params')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors ${
              activeTab === 'params'
                ? 'bg-ink text-white'
                : 'text-ink-muted hover:text-ink hover:bg-alabaster-muted'
            }`}
          >
            Params
          </button>
          {action.risk && action.risk.flags.length > 0 && (
            <button
              onClick={() => setActiveTab('risk')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1 ${
                activeTab === 'risk'
                  ? 'bg-terracotta text-white'
                  : 'text-terracotta hover:bg-terracotta-light'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              <span>Risk ({action.risk.flags.length})</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('raw')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1 ${
              activeTab === 'raw'
                ? 'bg-ink text-white'
                : 'text-ink-muted hover:text-ink hover:bg-alabaster-muted'
            }`}
          >
            <Code className="w-3 h-3" />
            <span>JSON</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Risk Warning Alert */}
        {action.risk && action.risk.flags.length > 0 && activeTab !== 'risk' && (
          <div className="p-3 rounded bg-terracotta-light border border-terracotta-border flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <ShieldAlert className="w-4 h-4 text-terracotta shrink-0" />
              <span>
                Risk Score: <strong>{action.risk.score}/100</strong> ({action.risk.level}) — {action.risk.flags[0].description}
              </span>
            </div>
            <button
              onClick={() => setActiveTab('risk')}
              className="text-[11px] font-bold text-terracotta underline shrink-0 hover:text-terracotta-hover"
            >
              Inspect Risk
            </button>
          </div>
        )}

        {/* Blocked Action Banner */}
        {action.status === 'blocked' && (
          <div className="p-3.5 rounded bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold uppercase tracking-wide">Action Blocked by Guardrail:</strong>
              <p className="mt-1 font-mono text-rose-800 text-[11px]">{action.reason}</p>
            </div>
          </div>
        )}

        {/* Failed Action Banner */}
        {action.status === 'failed' && action.error && (
          <div className="p-3.5 rounded bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">Execution Error:</strong>
              <p className="mt-1 font-mono text-[11px] text-rose-800">{action.error.message}</p>
            </div>
          </div>
        )}

        {/* TAB 1: Preview (Diff, Terminal, File Read, File List) */}
        {activeTab === 'preview' && (
          <>
            {action.kind === 'file.write' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-terracotta" />
                    <span>File Modification Diff</span>
                  </h3>
                  <span className="text-[11px] font-mono font-semibold text-ink-muted">{action.params.path}</span>
                </div>
                {renderDiff(action.metadata?.diff || action.result?.diff)}
              </div>
            )}

            {action.kind === 'process.exec' && (
              <div>
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-terracotta" />
                  <span>Shell Command Execution</span>
                </h3>
                {renderTerminal(action.result)}
              </div>
            )}

            {action.kind === 'file.read' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-ink" />
                    <span>File Content Preview</span>
                  </h3>
                  <span className="text-[11px] font-mono font-semibold text-ink-muted">{action.params.path}</span>
                </div>
                {action.result && (
                  <div className="font-mono text-xs bg-ink p-3.5 rounded border border-ink text-slate-200 overflow-x-auto max-h-96 whitespace-pre-wrap leading-relaxed">
                    {action.result.content}
                  </div>
                )}
              </div>
            )}

            {action.kind === 'file.list' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-terracotta" />
                    <span>Directory Entries ({action.result?.totalCount || 0})</span>
                  </h3>
                </div>
                {action.result?.entries && (
                  <div className="bg-white rounded border border-alabaster-border max-h-80 overflow-y-auto divide-y divide-alabaster-border font-mono text-xs">
                    {action.result.entries.map((entry: any, i: number) => (
                      <div key={i} className="py-2 px-3 flex items-center justify-between text-ink hover:bg-alabaster-muted">
                        <span className="font-medium text-ink">{entry.path}</span>
                        <span className="text-[10px] text-ink-muted uppercase font-bold bg-alabaster-muted px-1.5 py-0.5 rounded border border-alabaster-border">
                          {entry.type}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* TAB 2: Parameters & Result */}
        {activeTab === 'params' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-bold text-ink uppercase tracking-wider mb-1.5">
                Input Parameters
              </h4>
              <pre className="font-mono text-xs bg-ink p-3.5 rounded border border-ink text-slate-200 overflow-x-auto">
                {JSON.stringify(action.params, null, 2)}
              </pre>
            </div>

            {action.result && (
              <div>
                <h4 className="text-xs font-bold text-ink uppercase tracking-wider mb-1.5">
                  Execution Result
                </h4>
                <pre className="font-mono text-xs bg-ink p-3.5 rounded border border-ink text-emerald-300 overflow-x-auto">
                  {JSON.stringify(action.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Security Risk Details */}
        {activeTab === 'risk' && action.risk && (
          <div className="space-y-4">
            <div className="p-4 rounded bg-alabaster-muted border border-alabaster-border flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">Overall Risk Assessment</span>
                <p className="text-2xl font-black text-ink font-mono mt-0.5">
                  {action.risk.score} / 100
                </p>
              </div>
              <span
                className={`px-3 py-1 rounded text-xs font-black uppercase tracking-wider ${
                  action.risk.level === 'CRITICAL'
                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                    : action.risk.level === 'HIGH'
                    ? 'bg-terracotta-light text-terracotta border border-terracotta-border'
                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {action.risk.level}
              </span>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-ink uppercase tracking-wider">
                Triggered Rules ({action.risk.flags.length})
              </h4>
              {action.risk.flags.map((flag, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded bg-white border border-alabaster-border flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-terracotta font-bold">[{flag.ruleId}]</span>
                      <span className="font-bold text-ink">{flag.description}</span>
                    </div>
                    <p className="text-[11px] text-ink-muted mt-1 font-medium">Severity: {flag.severity}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded font-mono font-black text-[11px] text-terracotta bg-terracotta-light border border-terracotta-border shrink-0">
                    +{flag.scoreImpact} PTS
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: Raw Event JSON */}
        {activeTab === 'raw' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink uppercase tracking-wider">
                Raw Event JSON
              </span>
              <button
                onClick={() => handleCopy(JSON.stringify(action, null, 2), 'raw')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white hover:bg-alabaster-muted text-ink text-[11px] font-mono font-bold border border-alabaster-border transition-colors"
              >
                {copiedSection === 'raw' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-ink-muted" />}
                <span>Copy JSON</span>
              </button>
            </div>
            <pre className="font-mono text-xs bg-ink p-3.5 rounded border border-ink text-slate-200 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(action, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
