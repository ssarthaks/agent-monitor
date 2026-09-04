"use client";

import React, { useState, useEffect } from "react";
import { Server, ShieldCheck, ShieldBan, RefreshCw, AlertTriangle, Cpu } from "lucide-react";

export function McpSourcesView() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchSources = async () => {
    try {
      setLoading(true);
      const res = await fetch("/mcp/sources");
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const handleQuarantine = async (sourceId: string) => {
    const reason = window.prompt("Reason for quarantining this MCP source:", "Security operator manual quarantine");
    if (!reason) return;

    try {
      setActionInProgress(sourceId);
      const res = await fetch(`/mcp/sources/${encodeURIComponent(sourceId)}/quarantine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        await fetchSources();
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTrust = async (sourceId: string) => {
    try {
      setActionInProgress(sourceId);
      const res = await fetch(`/mcp/sources/${encodeURIComponent(sourceId)}/trust`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchSources();
      }
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="flex-1 px-4 sm:px-6 py-4 flex flex-col gap-4 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white rounded border border-alabaster-border">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-terracotta" />
          <h2 className="text-sm font-black text-ink uppercase tracking-wide">
            Model Context Protocol (MCP) Server Sources
          </h2>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border">
            {sources.length} registered
          </span>
        </div>

        <button
          onClick={fetchSources}
          className="p-1.5 rounded hover:bg-alabaster-muted text-ink-muted transition-colors"
          title="Refresh Sources"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Grid of MCP Sources */}
      {sources.length === 0 ? (
        <div className="p-12 text-center bg-white rounded border border-alabaster-border text-ink-muted text-xs">
          {loading ? "Loading MCP sources..." : "No external MCP server sources registered yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((src) => {
            const isQuarantined = src.status === "QUARANTINED";
            const statusBadge = isQuarantined
              ? "bg-rose-100 text-rose-800 border-rose-300"
              : src.status === "HEALTHY"
                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                : "bg-amber-100 text-amber-800 border-amber-300";

            return (
              <div
                key={src.sourceId}
                className="p-4 rounded bg-white border border-alabaster-border flex flex-col justify-between gap-3 shadow-xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-ink truncate">
                      {src.sourceId}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${statusBadge}`}
                    >
                      {src.status}
                    </span>
                  </div>

                  <p className="text-xs text-ink-muted mt-1 font-mono break-all">
                    {src.command} {(src.args || []).join(" ")}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] bg-alabaster p-2 rounded border border-alabaster-border font-mono">
                  <div>
                    <span className="text-ink-muted text-[10px] block">PID:</span>
                    <span className="font-bold text-ink">{src.pid || "none"}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted text-[10px] block">Tools:</span>
                    <span className="font-bold text-ink">{src.toolCount || 0}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted text-[10px] block">Restarts:</span>
                    <span className="font-bold text-ink">{src.restartCount || 0}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted text-[10px] block">Failures:</span>
                    <span className="font-bold text-ink">{src.consecutiveFailures || 0}</span>
                  </div>
                </div>

                {src.quarantineReason && (
                  <div className="p-2 bg-rose-50 rounded border border-rose-200 text-rose-900 text-xs">
                    <span className="font-bold block text-[10px] uppercase">Quarantine Reason:</span>
                    <span>{src.quarantineReason}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-alabaster-border flex items-center justify-end gap-2">
                  {isQuarantined ? (
                    <button
                      disabled={actionInProgress === src.sourceId}
                      onClick={() => handleTrust(src.sourceId)}
                      className="px-3 py-1 text-xs font-bold rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 transition-colors"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Trust & Lift Quarantine
                    </button>
                  ) : (
                    <button
                      disabled={actionInProgress === src.sourceId}
                      onClick={() => handleQuarantine(src.sourceId)}
                      className="px-3 py-1 text-xs font-bold rounded bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 transition-colors"
                    >
                      <ShieldBan className="w-3.5 h-3.5" />
                      Quarantine Source
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

