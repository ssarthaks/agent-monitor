import { ApprovalRequest, ApprovalStatus } from '@agent-monitor/core';

export interface ApprovalStorage {
  createApproval(approval: ApprovalRequest): void;
  getApproval(id: string): ApprovalRequest | null;
  resolveApproval(
    id: string,
    decision: 'approved' | 'denied',
    resolvedBy?: string
  ): { success: boolean; approval: ApprovalRequest | null };
  expirePendingApprovals(maxAgeMs?: number): ApprovalRequest[];
}

export interface ApprovalManagerOptions {
  storage?: ApprovalStorage;
  timeoutMs?: number;
  onApprovalRequested?: (approval: ApprovalRequest) => Promise<void> | void;
  onApprovalResolved?: (approval: ApprovalRequest, decision: 'approved' | 'denied' | 'expired', resolvedBy: string) => Promise<void> | void;
}

export class ApprovalManager {
  private storage?: ApprovalStorage;
  private defaultTimeoutMs: number;
  private onApprovalRequested?: (approval: ApprovalRequest) => Promise<void> | void;
  private onApprovalResolved?: (approval: ApprovalRequest, decision: 'approved' | 'denied' | 'expired', resolvedBy: string) => Promise<void> | void;
  private pendingResolvers = new Map<string, (res: { decision: 'approved' | 'denied' | 'expired'; resolvedBy?: string }) => void>();
  private memoryApprovals = new Map<string, ApprovalRequest>();

  constructor(options: ApprovalManagerOptions = {}) {
    this.storage = options.storage;
    this.defaultTimeoutMs = options.timeoutMs || 300000;
    this.onApprovalRequested = options.onApprovalRequested;
    this.onApprovalResolved = options.onApprovalResolved;
  }

  async createApproval(approval: ApprovalRequest): Promise<void> {
    if (this.storage) {
      this.storage.createApproval(approval);
    } else {
      this.memoryApprovals.set(approval.id, { ...approval });
    }

    if (this.onApprovalRequested) {
      try {
        await this.onApprovalRequested(approval);
      } catch {
        // ignore notification error
      }
    }
  }

  getApproval(id: string): ApprovalRequest | null {
    if (this.storage) {
      return this.storage.getApproval(id);
    }
    return this.memoryApprovals.get(id) || null;
  }

  resolve(
    id: string,
    decision: 'approved' | 'denied',
    resolvedBy: string = 'user'
  ): { success: boolean; approval: ApprovalRequest | null } {
    let result: { success: boolean; approval: ApprovalRequest | null };

    if (this.storage) {
      result = this.storage.resolveApproval(id, decision, resolvedBy);
    } else {
      const app = this.memoryApprovals.get(id);
      if (!app || app.status !== 'pending') {
        result = { success: false, approval: app || null };
      } else {
        app.status = decision;
        app.resolvedBy = resolvedBy;
        app.resolvedAt = Date.now();
        result = { success: true, approval: app };
      }
    }

    if (result.success && result.approval) {
      const resolver = this.pendingResolvers.get(id);
      if (resolver) {
        resolver({ decision, resolvedBy });
        this.pendingResolvers.delete(id);
      }

      if (this.onApprovalResolved) {
        try {
          this.onApprovalResolved(result.approval, decision, resolvedBy);
        } catch {
          // ignore
        }
      }
    }

    return result;
  }

  async waitForResolution(
    id: string,
    timeoutMs?: number
  ): Promise<{ decision: 'approved' | 'denied' | 'expired'; resolvedBy?: string }> {
    const effectiveTimeout = timeoutMs || this.defaultTimeoutMs;

    // Check if already resolved
    const current = this.getApproval(id);
    if (current && current.status !== 'pending') {
      return {
        decision: current.status as 'approved' | 'denied' | 'expired',
        resolvedBy: current.resolvedBy || undefined,
      };
    }

    return new Promise((resolve) => {
      let timer: NodeJS.Timeout;
      let poller: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(poller);
        this.pendingResolvers.delete(id);
      };

      const handleDone = (res: { decision: 'approved' | 'denied' | 'expired'; resolvedBy?: string }) => {
        cleanup();
        resolve(res);
      };

      this.pendingResolvers.set(id, handleDone);

      // Periodic check in storage (e.g. SQLite updated by browser API)
      poller = setInterval(() => {
        const app = this.getApproval(id);
        if (app && app.status !== 'pending') {
          handleDone({
            decision: app.status as 'approved' | 'denied' | 'expired',
            resolvedBy: app.resolvedBy || undefined,
          });
        }
      }, 300);

      // Expiration timer
      timer = setTimeout(() => {
        let expiredApp: ApprovalRequest | null = null;
        if (this.storage) {
          const expiredList = this.storage.expirePendingApprovals(effectiveTimeout);
          expiredApp = expiredList.find((a) => a.id === id) || this.getApproval(id);
        } else {
          const app = this.memoryApprovals.get(id);
          if (app && app.status === 'pending') {
            app.status = 'expired';
            app.resolvedBy = 'timeout';
            app.resolvedAt = Date.now();
            expiredApp = app;
          }
        }

        if (expiredApp && this.onApprovalResolved) {
          try {
            this.onApprovalResolved(expiredApp, 'expired', 'timeout');
          } catch {
            // ignore
          }
        }

        handleDone({ decision: 'expired', resolvedBy: 'timeout' });
      }, effectiveTimeout);
    });
  }
}
