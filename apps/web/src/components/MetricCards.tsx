"use client";

import React from "react";
import { ActionItem } from "@/hooks/useSessionStream";
import { AgentEvent, AgentSession } from "@agent-monitor/core";
import {
  FileText,
  FileEdit,
  Terminal,
  AlertTriangle,
  ShieldCheck,
  Coins,
  DollarSign,
} from "lucide-react";

interface MetricCardsProps {
  actions: ActionItem[];
  session?: AgentSession | null;
  events?: AgentEvent[];
  activeFilter?: string | null;
  onSelectFilter?: (filter: string | null) => void;
}

export function MetricCards({
  actions,
  session,
  events = [],
  activeFilter,
  onSelectFilter,
}: MetricCardsProps) {
  const filesRead = actions.filter(
    (a) => a.kind === "file.read" && a.status === "completed",
  ).length;
  const filesWritten = actions.filter(
    (a) => a.kind === "file.write" && a.status === "completed",
  ).length;
  const commandsRun = actions.filter(
    (a) => a.kind === "process.exec" && a.status === "completed",
  ).length;
  const errorsCount = actions.filter(
    (a) => a.status === "failed" || a.status === "blocked",
  ).length;

  let totalTokens = session?.summary?.usage?.totalTokens || 0;
  let estimatedCost = session?.summary?.usage?.estimatedCostUsd || 0;

  if (totalTokens === 0) {
    for (const ev of events) {
      if (ev.type === "agent.message" && (ev as any).usage) {
        totalTokens += (ev as any).usage.totalTokens || 0;
        estimatedCost += (ev as any).usage.estimatedCostUsd || 0;
      }
    }
  }

  const cards = [
    {
      id: "file.read",
      label: "Files Read",
      value: filesRead.toString(),
      icon: FileText,
    },
    {
      id: "file.write",
      label: "Files Written",
      value: filesWritten.toString(),
      icon: FileEdit,
    },
    {
      id: "process.exec",
      label: "Commands Run",
      value: commandsRun.toString(),
      icon: Terminal,
    },
    {
      id: "tokens",
      label: "Total Tokens",
      value: totalTokens > 0 ? totalTokens.toLocaleString() : "0",
      icon: Coins,
    },
    {
      id: "cost",
      label: "Estimated Cost",
      value:
        estimatedCost > 0
          ? estimatedCost < 0.01
            ? `$${estimatedCost.toFixed(5)}`
            : `$${estimatedCost.toFixed(3)}`
          : "$0.00",
      icon: DollarSign,
    },
    {
      id: "error",
      label: "Errors / Blocked",
      value: errorsCount.toString(),
      icon: errorsCount > 0 ? AlertTriangle : ShieldCheck,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5 px-4 sm:px-6 pt-3 sm:pt-4 pb-1">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = activeFilter === c.id;

        return (
          <button
            key={c.id}
            onClick={() =>
              onSelectFilter && onSelectFilter(isActive ? null : c.id)
            }
            className={`text-left p-2.5 sm:p-3 rounded bg-white transition-all flex items-center justify-between border ${
              isActive
                ? "border-2 border-terracotta bg-terracotta-light"
                : "border-alabaster-border hover:border-ink/40 hover:bg-alabaster-muted"
            }`}
          >
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider truncate">
                {c.label}
              </p>
              <p className="text-lg sm:text-xl font-black text-ink mt-0.5 font-mono tracking-tight truncate">
                {c.value}
              </p>
            </div>
            <div
              className={`p-1.5 rounded border shrink-0 ml-1.5 ${
                isActive
                  ? "bg-terracotta text-white border-terracotta"
                  : "bg-alabaster-muted text-ink border-alabaster-border"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
