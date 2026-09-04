"use client";

import React, { useState, useEffect } from "react";
import { PolicyVersion, PolicyRule } from "@agent-monitor/core";
import { Shield, RotateCcw, Check, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";

export function PoliciesView() {
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PolicyVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchVersions = async () => {
    try {
      setLoading(true);
      const res = await fetch("/policy/versions");
      if (res.ok) {
        const data = await res.json();
        const vList: PolicyVersion[] = data.versions || [];
        setVersions(vList);
        if (!selectedVersion && vList.length > 0) {
          const active = vList.find((v) => v.isActive) || vList[0];
          setSelectedVersion(active);
        } else if (selectedVersion) {
          const updated = vList.find((v) => v.id === selectedVersion.id);
          if (updated) setSelectedVersion(updated);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, []);

  const handleRollback = async (versionNumber: number) => {
    if (!window.confirm(`Are you sure you want to rollback to policy version ${versionNumber}?`)) {
      return;
    }
    try {
      setActionLoading(true);
      const res = await fetch(`/policy/versions/${versionNumber}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "operator-web" }),
      });
      if (res.ok) {
        await fetchVersions();
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleRule = async (ruleId: string, currentEnabled: boolean) => {
    try {
      setActionLoading(true);
      const res = await fetch(`/policy/rules/${encodeURIComponent(ruleId)}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled, actor: "operator-web" }),
      });
      if (res.ok) {
        await fetchVersions();
      }
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex-1 px-4 sm:px-6 py-4 flex flex-col gap-4 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white rounded border border-alabaster-border">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-terracotta" />
          <h2 className="text-sm font-black text-ink uppercase tracking-wide">
            Deterministic Security Policy Versions
          </h2>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border">
            {versions.length} versions
          </span>
        </div>

        <button
          onClick={fetchVersions}
          className="p-1.5 rounded hover:bg-alabaster-muted text-ink-muted transition-colors"
          title="Refresh Policy Versions"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* Left: Versions List */}
        <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-230px)]">
          {versions.map((v) => {
            const isSelected = selectedVersion?.id === v.id;
            return (
              <div
                key={v.id}
                onClick={() => setSelectedVersion(v)}
                className={`p-3.5 rounded bg-white border cursor-pointer transition-all flex flex-col gap-1.5 ${
                  isSelected
                    ? "border-terracotta shadow-xs ring-1 ring-terracotta"
                    : "border-alabaster-border hover:border-alabaster-borderDark"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-ink">
                    v{v.versionNumber} ({v.id})
                  </span>
                  {v.isActive && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                      ACTIVE
                    </span>
                  )}
                </div>

                <p className="text-xs font-semibold text-ink truncate">
                  {v.name || "Default Policy"}
                </p>

                <div className="flex items-center justify-between text-[10px] font-mono text-ink-faint pt-1 border-t border-alabaster-border">
                  <span>Rules: {v.rules.length}</span>
                  <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Selected Version Details & Rule Toggles */}
        <div className="lg:col-span-8 bg-white rounded border border-alabaster-border p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-230px)]">
          {selectedVersion ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-alabaster-border pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-ink">
                      Policy Version {selectedVersion.versionNumber}: {selectedVersion.name}
                    </h3>
                    {selectedVersion.isActive && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Hash: <span className="font-mono">{selectedVersion.hash}</span>
                  </p>
                </div>

                {!selectedVersion.isActive && (
                  <button
                    disabled={actionLoading}
                    onClick={() => handleRollback(selectedVersion.versionNumber)}
                    className="px-3 py-1.5 text-xs font-bold rounded bg-ink hover:bg-ink-light text-white flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-terracotta" />
                    Rollback to this Version
                  </button>
                )}
              </div>

              {/* Rules Table */}
              <div>
                <span className="text-xs font-bold text-ink block mb-2">
                  Configured Policy Rules ({selectedVersion.rules.length}):
                </span>

                <div className="space-y-2">
                  {selectedVersion.rules.map((rule) => {
                    const isEnabled = rule.enabled !== false;
                    const decBadge =
                      rule.decision === "DENY"
                        ? "bg-rose-100 text-rose-800 border-rose-300"
                        : rule.decision === "ASK"
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-emerald-100 text-emerald-800 border-emerald-300";

                    return (
                      <div
                        key={rule.id}
                        className={`p-3 rounded border text-xs flex items-center justify-between gap-3 ${
                          isEnabled
                            ? "bg-white border-alabaster-border"
                            : "bg-alabaster-muted/50 border-alabaster-border opacity-60"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono font-bold text-ink">
                              {rule.id}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded border uppercase ${decBadge}`}
                            >
                              {rule.decision}
                            </span>
                            {!isEnabled && (
                              <span className="text-[10px] font-bold text-ink-muted uppercase">
                                [DISABLED]
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-ink-muted font-mono">
                            <span>Action: {rule.action || "*"}</span>
                            {rule.path && <span>Path: {rule.path}</span>}
                            {rule.command && <span>Command: {rule.command}</span>}
                          </div>

                          {rule.reason && (
                            <p className="text-[11px] text-ink-faint mt-1">
                              Reason: {rule.reason}
                            </p>
                          )}
                        </div>

                        {/* Toggle Button if this is the active version */}
                        {selectedVersion.isActive && (
                          <button
                            disabled={actionLoading}
                            onClick={() => handleToggleRule(rule.id, isEnabled)}
                            className="p-1 text-ink-muted hover:text-ink transition-colors"
                            title={isEnabled ? "Disable Rule" : "Enable Rule"}
                          >
                            {isEnabled ? (
                              <ToggleRight className="w-6 h-6 text-emerald-600" />
                            ) : (
                              <ToggleLeft className="w-6 h-6 text-ink-faint" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-ink-muted italic">
              Select a policy version from the list to inspect rules and history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

