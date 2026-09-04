import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import {
  ActionNormalizer,
  ActionSource,
  RiskAnalyzer,
  PolicyEngine,
  BehavioralEngine,
  computeToolFingerprint,
  ExternalToolDefinition,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionBlockedEvent,
  PolicyEvaluatedEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  ToolDiscoveredEvent,
  ToolChangedEvent,
} from "@agent-monitor/core";
import { SessionRepository } from "@agent-monitor/server";
import {
  ApprovalManager,
  EventSink,
  resolveSafeWorkspacePath,
} from "@agent-monitor/agent";
import {
  McpProxyOptions,
  ToolGateway,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  MCP_METHOD_SECURITY_TABLE,
} from "../types.js";
import {
  JsonRpcStreamParser,
  serializeJsonRpc,
  createJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcNotification,
  isJsonRpcResponse,
} from "./jsonrpc.js";
import { McpResultInspector } from "./inspector.js";

export class McpStdioProxy implements ToolGateway {
  private options: McpProxyOptions;
  private childProcess: ChildProcess | null = null;
  private running = false;
  private clientParser = new JsonRpcStreamParser();
  private downstreamParser = new JsonRpcStreamParser();

  private pendingClientRequests = new Map<
    string | number,
    {
      request: JsonRpcRequest;
      resolve: (res: JsonRpcResponse) => void;
      startTime: number;
      normalizedAction?: any;
      actionId?: string;
      isOutsideWorkspace?: boolean;
      isToolMutated?: boolean;
    }
  >();

  private actionCounter = 0;

  constructor(options: McpProxyOptions) {
    this.options = {
      agentId: "mcp-client",
      agentName: "MCP Client Agent",
      clientInputStream: process.stdin,
      clientOutputStream: process.stdout,
      logStream: process.stderr,
      ...options,
    };
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  }

  private log(message: string): void {
    if (this.options.logStream) {
      this.options.logStream.write(`${message}\n`);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.log(
      pc.cyan(
        `[Agent Monitor Gateway] Spawning downstream MCP server: ${this.options.command} ${(this.options.args || []).join(" ")}`,
      ),
    );

    let workingDir = this.options.cwd || this.options.workspaceRoot;
    if (!workingDir || !fs.existsSync(workingDir)) {
      workingDir = process.cwd();
    }

    // Spawn downstream child process
    this.childProcess = spawn(this.options.command, this.options.args || [], {
      cwd: workingDir,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "inherit"], // child stderr passes through to terminal stderr
    });

    this.running = true;

    // 1. Listen for data from Client (stdin) -> clientParser
    this.options.clientInputStream?.on("data", (chunk) => {
      this.clientParser.write(chunk);
    });

    this.clientParser.on("message", (msg: JsonRpcMessage) => {
      this.handleClientMessage(msg).catch((err) => {
        this.log(
          pc.red(
            `[Gateway Error] Failed to handle client message: ${err.message}`,
          ),
        );
      });
    });

    this.clientParser.on("error", (err) => {
      this.log(
        pc.yellow(
          `[Gateway Warning] Malformed JSON-RPC from client: ${err.message}`,
        ),
      );
    });

    // 2. Listen for data from Downstream Server (stdout) -> downstreamParser
    this.childProcess.stdout?.on("data", (chunk) => {
      this.downstreamParser.write(chunk);
    });

    this.downstreamParser.on("message", (msg: JsonRpcMessage) => {
      this.handleDownstreamMessage(msg);
    });

    this.downstreamParser.on("error", (err) => {
      this.log(
        pc.yellow(
          `[Gateway Warning] Malformed JSON-RPC from downstream: ${err.message}`,
        ),
      );
    });

    // 3. Child process lifecycle
    this.childProcess.on("exit", (code, signal) => {
      this.log(
        pc.dim(
          `[Gateway] Downstream MCP process exited (code=${code}, signal=${signal})`,
        ),
      );
      this.running = false;
      for (const [id, pending] of this.pendingClientRequests.entries()) {
        pending.resolve(
          createJsonRpcError(
            id,
            -32000,
            `Downstream MCP server process exited (code=${code}, signal=${signal})`,
          ),
        );
      }
      this.pendingClientRequests.clear();
    });

    this.childProcess.on("error", (err) => {
      this.log(
        pc.red(
          `[Gateway Error] Downstream child process error: ${err.message}`,
        ),
      );
      for (const [id, pending] of this.pendingClientRequests.entries()) {
        pending.resolve(
          createJsonRpcError(
            id,
            -32000,
            `Downstream MCP server process error: ${err.message}`,
          ),
        );
      }
      this.pendingClientRequests.clear();
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.childProcess) return;

    this.running = false;
    const proc = this.childProcess;
    this.childProcess = null;

    try {
      proc.stdin?.destroy();
      proc.stdout?.destroy();
    } catch {}

    for (const [id, pending] of this.pendingClientRequests.entries()) {
      pending.resolve(
        createJsonRpcError(id, -32000, "Downstream MCP server proxy stopped"),
      );
    }
    this.pendingClientRequests.clear();

    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(killTimer);
          resolve();
        }
      };

      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
        done();
      }, 1000);

      proc.once("exit", done);

      try {
        proc.kill("SIGTERM");
      } catch {
        done();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Client Request Interception Pipeline
  // ─────────────────────────────────────────────────────────────

  private async handleClientMessage(msg: any): Promise<void> {
    // 1. JSON-RPC Batch handling (VULN-01 fix)
    if (Array.isArray(msg)) {
      if (msg.length === 0) {
        this.sendToClient(
          createJsonRpcError(null, -32600, "Invalid Request: empty batch"),
        );
        return;
      }
      const responses: JsonRpcResponse[] = [];
      for (const item of msg) {
        const res = await this.handleSingleClientMessage(item);
        if (res) {
          responses.push(res);
        }
      }
      if (responses.length > 0) {
        this.sendToClient(responses as any);
      }
      return;
    }

    // 2. Single JSON-RPC message handling
    const res = await this.handleSingleClientMessage(msg);
    if (res) {
      this.sendToClient(res);
    }
  }

  private async handleSingleClientMessage(
    msg: any,
  ): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== "object") {
      return createJsonRpcError(
        null,
        -32600,
        "Invalid Request: message must be an object",
      );
    }

    // A. Intercept tools/call
    if (msg.method === "tools/call") {
      // Notification on tools/call is forbidden in MCP (an 'id' is required)
      if (msg.id === undefined || msg.id === null) {
        return createJsonRpcError(
          null,
          -32600,
          "Invalid Request: 'tools/call' cannot be invoked as a notification. An 'id' is required.",
        );
      }
      return await this.interceptToolCall(msg as JsonRpcRequest);
    }

    // B. Intercept resources/read (FINDING-01 Fix: Resource Read Control Plane Interception)
    if (msg.method === "resources/read") {
      if (msg.id === undefined || msg.id === null) {
        return createJsonRpcError(
          null,
          -32600,
          "Invalid Request: 'resources/read' cannot be invoked as a notification. An 'id' is required.",
        );
      }
      return await this.interceptResourceRead(msg as JsonRpcRequest);
    }

    // C. Notifications (no response expected)
    if (isJsonRpcNotification(msg)) {
      this.forwardToDownstream(msg);
      return null;
    }

    // D. Not a request (e.g. response or invalid frame)
    if (!isJsonRpcRequest(msg)) {
      this.forwardToDownstream(msg);
      return null;
    }

    const request = msg as JsonRpcRequest;

    // E. Intercept tools/list (for tool discovery and fingerprinting)
    if (request.method === "tools/list") {
      return this.forwardWithCorrelation(request);
    }

    // F. Safe MCP discovery/lifecycle methods
    const classification = MCP_METHOD_SECURITY_TABLE[request.method];
    if (classification && classification.safePassthrough) {
      return this.forwardWithCorrelation(request);
    }

    // G. Fail closed on unsupported or unclassified requests
    if (!classification) {
      this.log(
        pc.yellow(
          `[Agent Monitor Warning] Blocked unclassified MCP method '${request.method}' to enforce security boundary.`,
        ),
      );
      return createJsonRpcError(
        request.id,
        -32601,
        `Method not supported or blocked by security control: ${request.method}`,
      );
    }

    return this.forwardWithCorrelation(request);
  }

  private forwardWithCorrelation(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve) => {
      this.pendingClientRequests.set(request.id, {
        request,
        resolve,
        startTime: Date.now(),
      });
      this.forwardToDownstream(request);
    });
  }

  private forwardToDownstream(msg: JsonRpcMessage): void {
    if (
      !this.childProcess ||
      !this.childProcess.stdin ||
      !this.childProcess.stdin.writable
    ) {
      if (isJsonRpcRequest(msg)) {
        const pending = this.pendingClientRequests.get(msg.id);
        const err = createJsonRpcError(
          msg.id,
          -32000,
          "Downstream MCP server process is unavailable",
        );
        if (pending) {
          this.pendingClientRequests.delete(msg.id);
          pending.resolve(err);
        } else {
          this.sendToClient(err);
        }
      }
      return;
    }

    const serialized = serializeJsonRpc(msg, false);
    this.childProcess.stdin.write(serialized);
  }

  private sendToClient(msg: JsonRpcMessage | JsonRpcMessage[]): void {
    if (
      !this.options.clientOutputStream ||
      !this.options.clientOutputStream.writable
    ) {
      return;
    }
    const serialized = serializeJsonRpc(msg as any, false);
    this.options.clientOutputStream.write(serialized);
  }

  // ─────────────────────────────────────────────────────────────
  // Core Tool Call Interception (Deterministic Policy + Kill Switch)
  // ─────────────────────────────────────────────────────────────

  private async interceptToolCall(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    const rawParams = request.params || {};
    const toolName = String(rawParams.name || "unknown");
    const toolArgs = rawParams.arguments || {};
    const actionId = this.generateId("act");
    const startTime = Date.now();

    const actionSource: ActionSource = {
      type: "mcp",
      server: this.options.serverName || this.options.command,
      transport: "stdio",
      toolName,
    };

    // 1. Authoritative Kill Switch Check (Zero-Bypass Circuit Breaker)
    if (this.options.repository.isKillSwitchActive(this.options.sessionId)) {
      const blockedEvent: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: toolName,
        category: "custom",
        params: toolArgs,
        reason: "Execution blocked: Session was killed by operator kill switch",
        risk: {
          level: "CRITICAL",
          score: 100,
          flags: [
            {
              ruleId: "KILL_SWITCH_ACTIVE",
              description: "Session killed by operator kill switch",
              severity: "CRITICAL",
              scoreImpact: 100,
            },
          ],
        },
        policy: {
          decision: "DENY",
          matchedPolicies: ["authoritative-kill-switch"],
          reason: "Session killed by operator",
        },
      };

      await this.options.eventSink.emit(blockedEvent);

      // Return standard MCP tool error result (isError: true) without invoking downstream
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: "Execution blocked: Session was killed by operator kill switch",
            },
          ],
        },
      };
    }

    // 2. Action Normalization
    const canonical = ActionNormalizer.normalize(
      toolName,
      toolArgs,
      actionSource,
    );

    // 3. Behavioral Sequence Evaluation
    let hasPriorSensitiveRead = false;
    let hasPriorWorkspaceWrite = false;
    if (this.options.behavioralEngine) {
      const bCtx = this.options.behavioralEngine.getContext(
        this.options.sessionId,
      );
      hasPriorSensitiveRead = bCtx.sensitiveReads.length > 0;
      hasPriorWorkspaceWrite = bCtx.workspaceWrites.length > 0;

      const bMatches = this.options.behavioralEngine.evaluate(
        this.options.sessionId,
        {
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
        },
      );

      for (const match of bMatches) {
        this.options.repository.recordBehavioralMatch({
          id: this.generateId("bm"),
          sessionId: this.options.sessionId,
          ruleId: match.ruleId,
          name: match.name,
          severity: match.severity,
          reason: match.reason,
          triggeringActionId: actionId,
          priorActionIds: match.priorActionIds,
          createdAt: Date.now(),
        });

        await this.options.eventSink.emit({
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "behavioral.match",
          match,
        } as any);
      }
    }

    // 4. Deterministic Risk Assessment & Workspace Boundary Check
    // 4. Deterministic Risk Assessment & Workspace Boundary Check & Rug-Pull Check
    let isOutsideWorkspace = false;
    if (canonical.params && typeof canonical.params.path === "string") {
      const pathCheck = resolveSafeWorkspacePath(
        canonical.params.path,
        this.options.workspaceRoot,
      );
      isOutsideWorkspace = pathCheck.isOutsideWorkspace;
    }

    const source = `mcp:${this.options.serverName || this.options.command}`;
    const isToolMutated = this.options.repository.isToolMutated(
      this.options.sessionId,
      toolName,
      source,
    );

    const riskAnalyzer = this.options.riskAnalyzer || new RiskAnalyzer();
    const risk = riskAnalyzer.analyze(canonical.kind, canonical.params, {
      isOutsideWorkspace,
      isToolMutated,
    });

    // 5. Deterministic Policy Evaluation
    const policyEval = this.options.policyEngine.evaluate(
      {
        kind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        risk,
      },
      {
        workspaceRoot: this.options.workspaceRoot,
        agentId: this.options.agentId,
        isOutsideWorkspace,
        isToolMutated,
        hasPriorSensitiveRead,
        hasPriorWorkspaceWrite,
        source: `mcp:${actionSource.server || "default"}`,
      },
    );

    // 6. Emit policy.evaluated Event
    const policyEv: PolicyEvaluatedEvent = {
      id: this.generateId("evt"),
      sequence: this.options.repository.getNextSequence(this.options.sessionId),
      sessionId: this.options.sessionId,
      agentId: this.options.agentId || "mcp-client",
      timestamp: Date.now(),
      type: "policy.evaluated",
      actionId,
      decision: policyEval.decision,
      matchedPolicies: policyEval.matchedPolicies,
      specificity: policyEval.specificity,
      reason: policyEval.reason,
    };
    await this.options.eventSink.emit(policyEv);

    // 7. Policy Decision: DENY
    if (policyEval.decision === "DENY") {
      const blockedEv: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        reason: `Blocked by security policy: ${policyEval.reason}`,
        risk,
        policy: {
          decision: "DENY",
          matchedPolicies: policyEval.matchedPolicies,
          reason: policyEval.reason,
        },
      };
      await this.options.eventSink.emit(blockedEv);

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: `Security Violation: Action '${toolName}' (${canonical.kind}) was blocked by policy: ${policyEval.reason}`,
            },
          ],
        },
      };
    }

    // 8. Policy Decision: ASK (Human Approval)
    if (policyEval.decision === "ASK") {
      if (!this.options.approvalManager) {
        // No approval manager -> auto-deny for safety
        const blockedEv: ActionBlockedEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "action.blocked",
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
          reason:
            "Action requires approval, but approval manager is not configured",
          risk,
        };
        await this.options.eventSink.emit(blockedEv);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "Action requires human approval, but no approval manager is active",
              },
            ],
          },
        };
      }

      const approvalId = this.generateId("app");
      const approvalReq = {
        id: approvalId,
        actionId,
        sessionId: this.options.sessionId,
        actionKind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        risk,
        reason: policyEval.reason,
        matchedPolicies: policyEval.matchedPolicies,
        status: "pending" as const,
        createdAt: Date.now(),
      };

      const requestedEv: ApprovalRequestedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "approval.requested",
        approvalId,
        actionId,
        actionKind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        risk,
        reason: policyEval.reason,
        matchedPolicies: policyEval.matchedPolicies,
      };
      await this.options.eventSink.emit(requestedEv);

      await this.options.approvalManager.createApproval(approvalReq);
      const resolution =
        await this.options.approvalManager.waitForResolution(approvalId);

      const resolvedEv: ApprovalResolvedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "approval.resolved",
        approvalId,
        actionId,
        decision: resolution.decision,
        resolvedBy: resolution.resolvedBy,
      };
      await this.options.eventSink.emit(resolvedEv);

      if (resolution.decision !== "approved") {
        const blockedEv: ActionBlockedEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "action.blocked",
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
          reason:
            resolution.decision === "expired"
              ? "Approval request timed out"
              : "Approval denied by operator",
          risk,
        };
        await this.options.eventSink.emit(blockedEv);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Policy Error: Action '${toolName}' was ${resolution.decision === "expired" ? "timed out" : "denied by user"}`,
              },
            ],
          },
        };
      }

      // POST-APPROVAL KILL SWITCH RE-CHECK (FINDING-05 Fix: Authoritative Concurrency Invariant)
      if (this.options.repository.isKillSwitchActive(this.options.sessionId)) {
        const raceBlockedEv: ActionBlockedEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "action.blocked",
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
          reason:
            "Execution blocked: Session was killed by operator while approval was pending",
          risk: {
            level: "CRITICAL",
            score: 100,
            flags: [
              {
                ruleId: "KILL_SWITCH_ACTIVE",
                description:
                  "Session killed by operator kill switch during approval wait",
                severity: "CRITICAL",
                scoreImpact: 100,
              },
            ],
          },
          policy: {
            decision: "DENY",
            matchedPolicies: ["authoritative-kill-switch"],
            reason: "Session killed by operator during approval wait",
          },
        };
        await this.options.eventSink.emit(raceBlockedEv);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "Execution blocked: Session was killed by operator while approval was pending",
              },
            ],
          },
        };
      }
    }

    // 9. ALLOW or Approved -> Forward to Downstream Server
    const startedEv: ActionStartedEvent = {
      id: this.generateId("evt"),
      sequence: this.options.repository.getNextSequence(this.options.sessionId),
      sessionId: this.options.sessionId,
      agentId: this.options.agentId || "mcp-client",
      timestamp: startTime,
      type: "action.started",
      actionId,
      kind: canonical.kind,
      category: canonical.category,
      params: canonical.params,
      risk,
    };
    await this.options.eventSink.emit(startedEv);

    // Save correlation context for downstream response handling
    return new Promise<JsonRpcResponse>((resolve) => {
      this.pendingClientRequests.set(request.id, {
        request,
        resolve,
        startTime,
        normalizedAction: canonical,
        actionId,
        isOutsideWorkspace,
        isToolMutated,
      });

      this.forwardToDownstream(request);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Downstream Server Response Handling
  // ─────────────────────────────────────────────────────────────

  private handleDownstreamMessage(msg: any): void {
    if (Array.isArray(msg)) {
      for (const item of msg) {
        this.handleSingleDownstreamMessage(item);
      }
      return;
    }
    this.handleSingleDownstreamMessage(msg);
  }

  private handleSingleDownstreamMessage(msg: JsonRpcMessage): void {
    // If it's a notification from downstream, forward to client
    if (isJsonRpcNotification(msg)) {
      this.sendToClient(msg);
      return;
    }

    if (!isJsonRpcResponse(msg)) {
      this.sendToClient(msg);
      return;
    }

    const response = msg as JsonRpcResponse;
    const pending =
      response.id !== null && response.id !== undefined
        ? this.pendingClientRequests.get(response.id)
        : undefined;

    if (!pending) {
      this.sendToClient(response);
      return;
    }

    this.pendingClientRequests.delete(response.id!);

    // A. If this was a tools/list response: extract and record tool fingerprints
    if (pending.request.method === "tools/list") {
      this.handleToolsListResponse(response);
      pending.resolve(response);
      return;
    }

    // B. If this was an intercepted tools/call response: record action.completed and inspect
    if (
      pending.request.method === "tools/call" &&
      pending.actionId &&
      pending.normalizedAction
    ) {
      this.handleToolCallResponse(response, pending as any);
      return;
    }

    // C. If this was an intercepted resources/read response: record action.completed and inspect
    if (
      pending.request.method === "resources/read" &&
      pending.actionId &&
      pending.normalizedAction
    ) {
      this.handleResourceReadResponse(response, pending as any);
      return;
    }

    pending.resolve(response);
  }

  private handleToolsListResponse(response: JsonRpcResponse): void {
    if (!response.result || !Array.isArray(response.result.tools)) {
      return;
    }

    const tools: ExternalToolDefinition[] = response.result.tools;
    const source = `mcp:${this.options.serverName || this.options.command}`;

    for (const tool of tools) {
      const fingerprint = computeToolFingerprint(tool);
      const res = this.options.repository.recordToolFingerprint({
        id: this.generateId("tf"),
        sessionId: this.options.sessionId,
        toolName: tool.name,
        source,
        fingerprint,
        schemaJson: JSON.stringify(tool.inputSchema || {}),
        description: tool.description || "",
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      });

      if (res.status === "TOOL_DISCOVERED") {
        const discEv: ToolDiscoveredEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "tool.discovered",
          toolName: tool.name,
          source,
          fingerprint,
          description: tool.description || "",
          inputSchema: tool.inputSchema || {},
        };
        this.options.eventSink.emit(discEv).catch(() => {});
      } else if (res.status === "TOOL_CHANGED") {
        const changeEv: ToolChangedEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "tool.changed",
          toolName: tool.name,
          source,
          previousFingerprint: "previous",
          newFingerprint: fingerprint,
          diffSummary: `Tool definition mutated at runtime (change count: ${res.changeCount})`,
        };
        this.options.eventSink.emit(changeEv).catch(() => {});
      }
    }
  }

  private handleToolCallResponse(
    response: JsonRpcResponse,
    pending: {
      request: JsonRpcRequest;
      resolve: (res: JsonRpcResponse) => void;
      startTime: number;
      normalizedAction: any;
      actionId: string;
      isOutsideWorkspace?: boolean;
      isToolMutated?: boolean;
    },
  ): void {
    const durationMs = Date.now() - pending.startTime;
    const canonical = pending.normalizedAction;
    const actionId = pending.actionId;

    // Inspect result
    const inspection = McpResultInspector.inspect(response.result);
    if (inspection.modified) {
      response.result = inspection.result;
    }

    const riskAnalyzer = this.options.riskAnalyzer || new RiskAnalyzer();
    const risk = riskAnalyzer.analyze(canonical.kind, canonical.params, {
      isOutsideWorkspace: pending.isOutsideWorkspace,
      isToolMutated: pending.isToolMutated,
    });

    const completedEv: ActionCompletedEvent = {
      id: this.generateId("evt"),
      sequence: this.options.repository.getNextSequence(this.options.sessionId),
      sessionId: this.options.sessionId,
      agentId: this.options.agentId || "mcp-client",
      timestamp: Date.now(),
      type: "action.completed",
      actionId,
      kind: canonical.kind,
      category: canonical.category,
      params: canonical.params,
      result: response.result,
      durationMs,
      risk,
      metadata: {
        bytesProcessed: inspection.sizeBytes,
      },
    };

    this.options.eventSink.emit(completedEv).catch(() => {});

    if (this.options.behavioralEngine) {
      this.options.behavioralEngine.recordAction(this.options.sessionId, {
        actionId,
        kind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
      });
    }

    pending.resolve(response);
  }

  // ─────────────────────────────────────────────────────────────
  // Resource Read Interception (FINDING-01: MCP resources/read)
  // ─────────────────────────────────────────────────────────────

  private async interceptResourceRead(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    const rawParams = request.params || {};
    const uri = String(rawParams.uri || "");
    const actionId = this.generateId("act");
    const startTime = Date.now();

    // Normalize URI to target file path using standard fileURLToPath for RFC 8089 compliance
    let filePath = uri;
    if (filePath.startsWith("file://")) {
      try {
        filePath = fileURLToPath(uri);
      } catch {
        // Remote UNC, invalid host, or malformed file URI -> fail closed as external escape
        filePath =
          "/__external_network_or_invalid_host__/" +
          uri.replace(/^file:\/\//, "");
      }
    } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(filePath)) {
      // Any non-file URI with an explicit scheme (e.g. http://, s3://, custom://)
      // Must be treated as external/remote resource outside workspace
      filePath =
        "/__external_uri__/" +
        filePath.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    }

    const actionSource: ActionSource = {
      type: "mcp",
      server: this.options.serverName || this.options.command,
      transport: "stdio",
      toolName: "resources/read",
    };

    const canonical = {
      kind: "file.read" as const,
      category: "file" as const,
      params: {
        ...rawParams,
        uri,
        path: filePath,
      },
      source: actionSource,
      rawToolName: "resources/read",
      rawParams,
    };

    // 1. Authoritative Kill Switch Check
    if (this.options.repository.isKillSwitchActive(this.options.sessionId)) {
      const blockedEvent: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        reason: "Execution blocked: Session was killed by operator kill switch",
        risk: {
          level: "CRITICAL",
          score: 100,
          flags: [
            {
              ruleId: "KILL_SWITCH_ACTIVE",
              description: "Session killed by operator kill switch",
              severity: "CRITICAL",
              scoreImpact: 100,
            },
          ],
        },
        policy: {
          decision: "DENY",
          matchedPolicies: ["authoritative-kill-switch"],
          reason: "Session killed by operator",
        },
      };

      await this.options.eventSink.emit(blockedEvent);

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: "Execution blocked: Session was killed by operator kill switch",
            },
          ],
        },
      };
    }

    // 2. Behavioral Sequence Evaluation
    let hasPriorSensitiveRead = false;
    let hasPriorWorkspaceWrite = false;
    if (this.options.behavioralEngine) {
      const bCtx = this.options.behavioralEngine.getContext(
        this.options.sessionId,
      );
      hasPriorSensitiveRead = bCtx.sensitiveReads.length > 0;
      hasPriorWorkspaceWrite = bCtx.workspaceWrites.length > 0;

      const bMatches = this.options.behavioralEngine.evaluate(
        this.options.sessionId,
        {
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
        },
      );

      for (const match of bMatches) {
        this.options.repository.recordBehavioralMatch({
          id: this.generateId("bm"),
          sessionId: this.options.sessionId,
          ruleId: match.ruleId,
          name: match.name,
          severity: match.severity,
          reason: match.reason,
          triggeringActionId: actionId,
          priorActionIds: match.priorActionIds,
          createdAt: Date.now(),
        });

        await this.options.eventSink.emit({
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "behavioral.match",
          match,
        } as any);
      }
    }

    // 3. Workspace Boundary Check
    let isOutsideWorkspace = false;
    if (filePath) {
      const pathCheck = resolveSafeWorkspacePath(
        filePath,
        this.options.workspaceRoot,
      );
      isOutsideWorkspace = pathCheck.isOutsideWorkspace;
    }

    // 4. Deterministic Risk Assessment
    const riskAnalyzer = this.options.riskAnalyzer || new RiskAnalyzer();
    const risk = riskAnalyzer.analyze(canonical.kind, canonical.params, {
      isOutsideWorkspace,
    });

    // 5. Deterministic Policy Evaluation
    const policyEval = this.options.policyEngine.evaluate(
      {
        kind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        risk,
      },
      {
        workspaceRoot: this.options.workspaceRoot,
        agentId: this.options.agentId,
        isOutsideWorkspace,
        hasPriorSensitiveRead,
        hasPriorWorkspaceWrite,
        source: `mcp:${actionSource.server || "default"}`,
      },
    );

    // 6. Emit policy.evaluated Event
    const policyEv: PolicyEvaluatedEvent = {
      id: this.generateId("evt"),
      sequence: this.options.repository.getNextSequence(this.options.sessionId),
      sessionId: this.options.sessionId,
      agentId: this.options.agentId || "mcp-client",
      timestamp: Date.now(),
      type: "policy.evaluated",
      actionId,
      decision: policyEval.decision,
      matchedPolicies: policyEval.matchedPolicies,
      specificity: policyEval.specificity,
      reason: policyEval.reason,
    };
    await this.options.eventSink.emit(policyEv);

    // 7. Policy Decision: DENY
    if (policyEval.decision === "DENY") {
      const blockedEv: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        reason: `Blocked by security policy: ${policyEval.reason}`,
        risk,
        policy: {
          decision: "DENY",
          matchedPolicies: policyEval.matchedPolicies,
          reason: policyEval.reason,
        },
      };
      await this.options.eventSink.emit(blockedEv);

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: `Security Violation: Resource read '${uri}' (${canonical.kind}) was blocked by policy: ${policyEval.reason}`,
            },
          ],
        },
      };
    }

    // 8. Policy Decision: ASK
    if (policyEval.decision === "ASK") {
      if (!this.options.approvalManager) {
        const blockedEv: ActionBlockedEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "action.blocked",
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
          reason:
            "Resource read requires approval, but approval manager is not configured",
          risk,
        };
        await this.options.eventSink.emit(blockedEv);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "Resource read requires human approval, but no approval manager is active",
              },
            ],
          },
        };
      }

      const approvalId = this.generateId("app");
      const approvalReq = {
        id: approvalId,
        actionId,
        sessionId: this.options.sessionId,
        actionKind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        risk,
        reason: policyEval.reason,
        matchedPolicies: policyEval.matchedPolicies,
        status: "pending" as const,
        createdAt: Date.now(),
      };

      const requestedEv: ApprovalRequestedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "approval.requested",
        approvalId,
        actionId,
        actionKind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
        risk,
        reason: policyEval.reason,
        matchedPolicies: policyEval.matchedPolicies,
      };
      await this.options.eventSink.emit(requestedEv);

      await this.options.approvalManager.createApproval(approvalReq);
      const resolution =
        await this.options.approvalManager.waitForResolution(approvalId);

      const resolvedEv: ApprovalResolvedEvent = {
        id: this.generateId("evt"),
        sequence: this.options.repository.getNextSequence(
          this.options.sessionId,
        ),
        sessionId: this.options.sessionId,
        agentId: this.options.agentId || "mcp-client",
        timestamp: Date.now(),
        type: "approval.resolved",
        approvalId,
        actionId,
        decision: resolution.decision,
        resolvedBy: resolution.resolvedBy,
      };
      await this.options.eventSink.emit(resolvedEv);

      if (resolution.decision !== "approved") {
        const blockedEv: ActionBlockedEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "action.blocked",
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
          reason:
            resolution.decision === "expired"
              ? "Approval request timed out"
              : "Approval denied by operator",
          risk,
        };
        await this.options.eventSink.emit(blockedEv);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Policy Error: Resource read '${uri}' was ${resolution.decision === "expired" ? "timed out" : "denied by user"}`,
              },
            ],
          },
        };
      }

      // POST-APPROVAL KILL SWITCH RE-CHECK (FINDING-05 Fix)
      if (this.options.repository.isKillSwitchActive(this.options.sessionId)) {
        const raceBlockedEv: ActionBlockedEvent = {
          id: this.generateId("evt"),
          sequence: this.options.repository.getNextSequence(
            this.options.sessionId,
          ),
          sessionId: this.options.sessionId,
          agentId: this.options.agentId || "mcp-client",
          timestamp: Date.now(),
          type: "action.blocked",
          actionId,
          kind: canonical.kind,
          category: canonical.category,
          params: canonical.params,
          reason:
            "Execution blocked: Session was killed by operator while approval was pending",
          risk: {
            level: "CRITICAL",
            score: 100,
            flags: [
              {
                ruleId: "KILL_SWITCH_ACTIVE",
                description:
                  "Session killed by operator kill switch during approval wait",
                severity: "CRITICAL",
                scoreImpact: 100,
              },
            ],
          },
          policy: {
            decision: "DENY",
            matchedPolicies: ["authoritative-kill-switch"],
            reason: "Session killed by operator during approval wait",
          },
        };
        await this.options.eventSink.emit(raceBlockedEv);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "Execution blocked: Session was killed by operator while approval was pending",
              },
            ],
          },
        };
      }
    }

    // 9. ALLOW or Approved -> Forward to Downstream Server
    const startedEv: ActionStartedEvent = {
      id: this.generateId("evt"),
      sequence: this.options.repository.getNextSequence(this.options.sessionId),
      sessionId: this.options.sessionId,
      agentId: this.options.agentId || "mcp-client",
      timestamp: startTime,
      type: "action.started",
      actionId,
      kind: canonical.kind,
      category: canonical.category,
      params: canonical.params,
      risk,
    };
    await this.options.eventSink.emit(startedEv);

    // Save correlation context for downstream response handling
    return new Promise<JsonRpcResponse>((resolve) => {
      this.pendingClientRequests.set(request.id, {
        request,
        resolve,
        startTime,
        normalizedAction: canonical,
        actionId,
        isOutsideWorkspace,
      });

      this.forwardToDownstream(request);
    });
  }

  private handleResourceReadResponse(
    response: JsonRpcResponse,
    pending: {
      request: JsonRpcRequest;
      resolve: (res: JsonRpcResponse) => void;
      startTime: number;
      normalizedAction: any;
      actionId: string;
      isOutsideWorkspace?: boolean;
    },
  ): void {
    const durationMs = Date.now() - pending.startTime;
    const canonical = pending.normalizedAction;
    const actionId = pending.actionId;

    // Inspect result
    const inspection = McpResultInspector.inspect(response.result);
    if (inspection.modified) {
      response.result = inspection.result;
    }

    const riskAnalyzer = this.options.riskAnalyzer || new RiskAnalyzer();
    const risk = riskAnalyzer.analyze(canonical.kind, canonical.params, {
      isOutsideWorkspace: pending.isOutsideWorkspace,
    });

    const completedEv: ActionCompletedEvent = {
      id: this.generateId("evt"),
      sequence: this.options.repository.getNextSequence(this.options.sessionId),
      sessionId: this.options.sessionId,
      agentId: this.options.agentId || "mcp-client",
      timestamp: Date.now(),
      type: "action.completed",
      actionId,
      kind: canonical.kind,
      category: canonical.category,
      params: canonical.params,
      result: response.result,
      durationMs,
      risk,
      metadata: {
        bytesProcessed: inspection.sizeBytes,
      },
    };

    this.options.eventSink.emit(completedEv).catch(() => {});

    if (this.options.behavioralEngine) {
      this.options.behavioralEngine.recordAction(this.options.sessionId, {
        actionId,
        kind: canonical.kind,
        category: canonical.category,
        params: canonical.params,
      });
    }

    pending.resolve(response);
  }
}
