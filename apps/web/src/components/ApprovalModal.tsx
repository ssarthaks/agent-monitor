"use client";

import { useState } from "react";
import { ApprovalRequest } from "@agent-monitor/core";
import {
  ShieldAlert,
  Terminal,
  FileCode,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";

interface ApprovalModalProps {
  approval: ApprovalRequest;
  onApprove: (id: string) => Promise<void>;
  onDeny: (id: string) => Promise<void>;
}

export function ApprovalModal({
  approval,
  onApprove,
  onDeny,
}: ApprovalModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionType, setActionType] = useState<"approve" | "deny" | null>(null);

  const handleApprove = async () => {
    setIsSubmitting(true);
    setActionType("approve");
    try {
      await onApprove(approval.id);
    } finally {
      setIsSubmitting(false);
      setActionType(null);
    }
  };

  const handleDeny = async () => {
    setIsSubmitting(true);
    setActionType("deny");
    try {
      await onDeny(approval.id);
    } finally {
      setIsSubmitting(false);
      setActionType(null);
    }
  };

  const isCommand = approval.actionKind === "process.exec";
  const targetText =
    approval.params.command ||
    approval.params.path ||
    JSON.stringify(approval.params);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2B2D42]/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#FFFFFF] border-2 border-[#D46A43] shadow-2xl rounded-none flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-[#2B2D42] text-white px-6 py-4 flex items-center justify-between border-b border-[#2B2D42]">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-[#D46A43] animate-pulse" />
            <div>
              <h2 className="font-mono text-sm tracking-wider font-bold uppercase text-[#FFFFFF]">
                Action Requires Human Approval
              </h2>
              <p className="text-xs text-gray-300 font-sans">
                Policy Gate: V0.2 Deterministic Safety Enforcement
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 text-xs font-mono font-bold tracking-wide uppercase ${
                approval.risk.score >= 50
                  ? "bg-red-500/20 text-red-300 border border-red-500/40"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              }`}
            >
              Risk: {approval.risk.score}/100 {approval.risk.level}
            </span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 bg-[#FAFAFA]">
          {/* Target Action Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-[#2B2D42]/70">
              <span className="font-semibold flex items-center gap-1.5 uppercase">
                {isCommand ? (
                  <Terminal className="w-3.5 h-3.5" />
                ) : (
                  <FileCode className="w-3.5 h-3.5" />
                )}
                Requested Action ({approval.actionKind})
              </span>
              <span className="text-[11px] text-gray-500">
                Session: {approval.sessionId.slice(0, 14)}...
              </span>
            </div>

            <div className="bg-[#2B2D42] text-[#FAFAFA] p-4 font-mono text-xs overflow-x-auto border border-[#2B2D42]">
              <div className="flex items-start gap-2">
                <span className="text-[#D46A43] select-none">$</span>
                <span className="break-all font-semibold">{targetText}</span>
              </div>
            </div>
          </div>

          {/* Why was it flagged? */}
          <div className="bg-[#FFFFFF] border border-gray-200 p-4 space-y-2">
            <h4 className="text-xs font-mono font-bold text-[#2B2D42] uppercase tracking-wide">
              Why does this action require approval?
            </h4>
            <p className="text-xs text-gray-700 leading-relaxed">
              {approval.reason}
            </p>
            {approval.matchedPolicies &&
              approval.matchedPolicies.length > 0 && (
                <div className="pt-2 flex items-center gap-2 text-xs font-mono text-gray-500">
                  <span className="font-bold text-[#2B2D42]">
                    Matched Policy:
                  </span>
                  <span className="bg-gray-100 px-2 py-0.5 border border-gray-300 text-[#2B2D42]">
                    {approval.matchedPolicies.join(", ")}
                  </span>
                </div>
              )}
          </div>

          {/* Notice */}
          <p className="text-[11px] text-gray-500 italic">
            Allowing this action will grant single-use permission for this
            specific execution.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="bg-[#FFFFFF] px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleDeny}
            className="px-5 py-2.5 text-xs font-mono font-bold tracking-wider uppercase border-2 border-[#2B2D42] text-[#2B2D42] hover:bg-red-50 hover:border-red-600 hover:text-red-700 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting && actionType === "deny" ? (
              <Loader2 className="w-4 h-4 animate-spin text-red-600" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            Deny Action
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleApprove}
            className="px-6 py-2.5 text-xs font-mono font-bold tracking-wider uppercase bg-[#D46A43] hover:bg-[#E27D60] text-white border-2 border-[#D46A43] transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            {isSubmitting && actionType === "approve" ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <CheckCircle className="w-4 h-4 text-white" />
            )}
            Allow Once
          </button>
        </div>
      </div>
    </div>
  );
}
