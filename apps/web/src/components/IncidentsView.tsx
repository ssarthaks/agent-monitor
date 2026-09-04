"use client";

import React, { useState, useEffect } from "react";
import { SecurityIncident, IncidentStatus, IncidentSeverity } from "@agent-monitor/core";
import { ShieldAlert, AlertTriangle, CheckCircle2, Clock, Filter, RefreshCw } from "lucide-react";

interface IncidentsViewProps {
  sessionId?: string | null;
}

export function IncidentsView({ sessionId }: IncidentsViewProps) {
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedIncident, setSelectedIncident] = useState<SecurityIncident | null>(null);
  const [incidentEvents, setIncidentEvents] = useState<any[]>([]);
  const [updating, setUpdating] = useState(false);

  const fetchIncidents = async () => {
    try {
      setLoading(true);
      const url = sessionId ? `/incidents?sessionId=${sessionId}` : `/incidents`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setIncidents(data.incidents || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, [sessionId]);

  const loadIncidentEvents = async (inc: SecurityIncident) => {
    setSelectedIncident(inc);
    try {
      const res = await fetch(`/incidents/${inc.id}/events`);
      if (res.ok) {
        const data = await res.json();
        setIncidentEvents(data.events || []);
      }
    } catch {
      setIncidentEvents([]);
    }
  };

  const handleUpdateStatus = async (incidentId: string, newStatus: IncidentStatus) => {
    try {
      setUpdating(true);
      const res = await fetch(`/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, resolvedBy: "operator-web" }),
      });
      if (res.ok) {
        await fetchIncidents();
        if (selectedIncident && selectedIncident.id === incidentId) {
          setSelectedIncident({ ...selectedIncident, status: newStatus });
        }
      }
    } finally {
      setUpdating(false);
    }
  };

  const filteredIncidents = incidents.filter((inc) => {
    if (statusFilter === "ALL") return true;
    return inc.status === statusFilter;
  });

  return (
    <div className="flex-1 px-4 sm:px-6 py-4 flex flex-col gap-4 max-w-7xl mx-auto w-full">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white rounded border border-alabaster-border">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-terracotta" />
          <h2 className="text-sm font-black text-ink uppercase tracking-wide">
            Security Incidents & Operations
          </h2>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border">
            {incidents.length} total
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs">
            {["ALL", "OPEN", "INVESTIGATING", "CONTAINED", "RESOLVED"].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                  statusFilter === st
                    ? "bg-ink text-white"
                    : "bg-alabaster hover:bg-alabaster-muted text-ink-muted"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <button
            onClick={fetchIncidents}
            className="p-1.5 rounded hover:bg-alabaster-muted text-ink-muted transition-colors"
            title="Refresh Incidents"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area: List + Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* Left: Incident List */}
        <div className="lg:col-span-6 flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-230px)]">
          {filteredIncidents.length === 0 ? (
            <div className="p-8 text-center bg-white rounded border border-alabaster-border text-ink-muted text-xs">
              {loading ? "Loading incidents..." : "No security incidents found matching criteria."}
            </div>
          ) : (
            filteredIncidents.map((inc) => {
              const isSelected = selectedIncident?.id === inc.id;
              const sevBadge =
                inc.severity === "CRITICAL"
                  ? "bg-rose-100 text-rose-800 border-rose-300"
                  : inc.severity === "HIGH"
                    ? "bg-amber-100 text-amber-800 border-amber-300"
                    : "bg-blue-100 text-blue-800 border-blue-300";

              return (
                <div
                  key={inc.id}
                  onClick={() => loadIncidentEvents(inc)}
                  className={`p-3.5 rounded bg-white border transition-all cursor-pointer flex flex-col gap-2 ${
                    isSelected
                      ? "border-terracotta shadow-xs ring-1 ring-terracotta"
                      : "border-alabaster-border hover:border-alabaster-borderDark"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ink">
                        {inc.incidentNumber}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${sevBadge}`}
                      >
                        {inc.severity}
                      </span>
                    </div>

                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-alabaster-muted text-ink border border-alabaster-border uppercase">
                      {inc.status}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-ink">{inc.title}</h3>
                    {inc.description && (
                      <p className="text-[11px] text-ink-muted line-clamp-2 mt-0.5">
                        {inc.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-ink-faint pt-1 border-t border-alabaster-border">
                    <span>Trigger: {inc.triggerType}</span>
                    <span>{new Date(inc.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: Selected Incident Detail */}
        <div className="lg:col-span-6 bg-white rounded border border-alabaster-border p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-230px)]">
          {selectedIncident ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-alabaster-border pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-ink">
                      {selectedIncident.incidentNumber}
                    </span>
                    <span className="text-xs font-bold text-ink-muted">
                      ({selectedIncident.id})
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-ink mt-1">
                    {selectedIncident.title}
                  </h3>
                </div>

                {/* Status Transition Control */}
                <div className="flex flex-col items-end gap-1.5">
                  <span className="text-[10px] font-bold text-ink-muted uppercase">
                    Change Status
                  </span>
                  <select
                    disabled={updating}
                    value={selectedIncident.status}
                    onChange={(e) =>
                      handleUpdateStatus(selectedIncident.id, e.target.value as IncidentStatus)
                    }
                    className="text-xs font-bold bg-alabaster border border-alabaster-border px-2 py-1 rounded text-ink cursor-pointer"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="INVESTIGATING">INVESTIGATING</option>
                    <option value="CONTAINED">CONTAINED</option>
                    <option value="RESOLVED">RESOLVED</option>
                    <option value="FALSE_POSITIVE">FALSE_POSITIVE</option>
                  </select>
                </div>
              </div>

              {/* Details Fields */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-alabaster-muted p-3 rounded border border-alabaster-border">
                <div>
                  <span className="text-ink-muted text-[10px] uppercase font-bold block">
                    Trigger Type
                  </span>
                  <span className="font-mono font-bold text-ink">
                    {selectedIncident.triggerType}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted text-[10px] uppercase font-bold block">
                    Session ID
                  </span>
                  <span className="font-mono font-bold text-ink truncate block">
                    {selectedIncident.sessionId}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted text-[10px] uppercase font-bold block">
                    Created At
                  </span>
                  <span className="font-mono text-ink">
                    {new Date(selectedIncident.createdAt).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted text-[10px] uppercase font-bold block">
                    Updated At
                  </span>
                  <span className="font-mono text-ink">
                    {new Date(selectedIncident.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Description */}
              {selectedIncident.description && (
                <div>
                  <span className="text-xs font-bold text-ink block mb-1">
                    Incident Description:
                  </span>
                  <p className="text-xs text-ink-muted bg-alabaster p-2.5 rounded border border-alabaster-border font-mono whitespace-pre-wrap">
                    {selectedIncident.description}
                  </p>
                </div>
              )}

              {/* Related Audit Events */}
              <div>
                <span className="text-xs font-bold text-ink block mb-2">
                  Correlated Security Events ({incidentEvents.length}):
                </span>
                {incidentEvents.length === 0 ? (
                  <p className="text-xs text-ink-muted italic">
                    No linked events retrieved.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {incidentEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="p-2 rounded bg-alabaster border border-alabaster-border text-xs flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-mono font-bold text-ink">
                            #{evt.sequence} {evt.type}
                          </span>
                          <span className="text-ink-faint font-mono">
                            {new Date(evt.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {evt.reason && (
                          <span className="text-[11px] text-rose-700 font-semibold">
                            {evt.reason}
                          </span>
                        )}
                        {evt.actionId && (
                          <span className="text-[10px] font-mono text-ink-muted">
                            Action: {evt.actionId}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-ink-muted italic">
              Select an incident from the list to inspect details and audit history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

