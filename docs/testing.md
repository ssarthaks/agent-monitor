# Testing Guide

Agent Monitor employs a comprehensive Vitest test suite testing deterministic risk scoring, additive policy specificity, SQLite atomic concurrency, SSE streaming, and CLI commands.

---

## 1. Running Tests

```bash
# Run all test suites
npm test

# Run tests in watch mode
npx vitest

# Run a specific test file
npx vitest run packages/core/test/policy-engine.test.ts
```

---

## 2. Test Suite Architecture (26 Test Suites, 141 Tests)

| Test Suite | Location | Scope |
| :--- | :--- | :--- |
| **Policy Engine Tests** | `packages/core/test/policy-engine.test.ts` | Specificity calculation, rule precedence, root-level vs nested glob matching (`**/*.secret`). |
| **Risk Analyzer Tests** | `packages/core/test/risk-analyzer.test.ts` | Heuristic vector checks (`SEC_DOTENV`, `CMD_DESTRUCTIVE_RM`, `PATH_TRAVERSAL`). |
| **Normalization Tests** | `packages/core/test/normalization.test.ts` | Action canonicalization, path normalization, RFC 8089 URI conversions. |
| **Tool Fingerprinting Tests** | `packages/core/test/fingerprint.test.ts` | SHA-256 tool fingerprint calculation, schema change detection. |
| **Behavioral Correlation Tests** | `packages/core/test/behavior.test.ts` | Sequence tracking, sliding window bounds (`MAX_BEHAVIORAL_RECORDS`). |
| **Behavioral V2 Rules Tests** | `packages/core/test/behavior-v2.test.ts` | Multi-step sequences: `SEC_MUTATION_TO_READ`, `SEC_TRAVERSAL_TO_EXEC`, `SEC_DENIAL_TO_ALTERNATIVE`. |
| **Database Migrations Tests** | `packages/server/test/migrations.test.ts` | Sequential migration runner execution, rollback safety, table schema validation. |
| **Policy Versions API Tests** | `packages/server/test/policy-versions.test.ts` | Policy version persistence, diff calculation, dynamic rule toggling, rollbacks. |
| **Incidents API Tests** | `packages/server/test/incidents.test.ts` | Incident case creation, severity filtering, status updates, correlated events. |
| **Session Risk Breakdown Tests** | `packages/server/test/session-risk.test.ts` | Session risk scoring, explainability factors, CWE breakdown. |
| **Audit Integrity Tests** | `packages/server/test/audit-integrity.test.ts` | SHA-256 hash chaining, sequential verification, tamper detection. |
| **Approval Repository Tests** | `packages/server/test/approval-repository.test.ts` | SQLite CRUD, atomic conditional update (`status = 'pending'`), expiry queries. |
| **Server & API Tests** | `packages/server/test/server.test.ts` | REST endpoints, SSE stream subscription, session creation. |
| **Approval API Tests** | `packages/server/test/approval-api.test.ts` | `/approvals/:id/approve` and `/deny` routes, HTTP 409 Conflict handling. |
| **Approval Integration & Race Tests** | `packages/server/test/approval-integration.test.ts` | Single authoritative event emission, approve vs deny races, dynamic agentId derivation. |
| **V0.3 Features Tests** | `packages/server/test/v03-features.test.ts` | Multi-server tool mutation shadowing, kill switch verification, tool persistence. |
| **Tools & Guardrails Tests** | `packages/agent/test/tools.test.ts` | Path containment, symlink checks, diff generation, command execution timeouts. |
| **Interceptor Tests** | `packages/agent/test/interceptor.test.ts` | Core action interception, kill switch checks, event emission. |
| **Interceptor Policy Tests** | `packages/agent/test/interceptor-policy.test.ts` | Strict event sequencing across `ALLOW`, `DENY`, `ASK+approved`, `ASK+denied`, and `ASK+expired`. |
| **V0.3 Interceptor Tests** | `packages/agent/test/v03-interceptor.test.ts` | Post-approval kill switch enforcement, tool mutation check before execution. |
| **DeepSeek Mock Tests** | `packages/agent/test/deepseek-mock.test.ts` | Mocked agent prompt-and-tool loop execution. |
| **MCP Proxy Protocol Tests** | `packages/gateway/test/mcp-proxy.test.ts` | Stdio proxy interception, `tools/call`, `resources/read`, RFC 8089 fail-closed. |
| **MCP JSON-RPC Tests** | `packages/gateway/test/jsonrpc.test.ts` | Strict byte-buffer framing, oversized payload rejection, framing validation. |
| **MCP V4 Features Tests** | `packages/gateway/test/mcp-v4-features.test.ts` | Sticky quarantine enforcement, sliding rate limit, execution timeouts, secret leak inspection. |
| **CLI Commands Tests** | `packages/cli/test/cli-commands.test.ts` | `config init`, `--force` overwriting, config validation, kill/resume commands. |
| **CLI V4 Commands Tests** | `packages/cli/test/cli-v4.test.ts` | `policy versions/rollback/diff`, `incidents`, `mcp quarantine/trust`, `audit verify`, `--json`. |


---

## 3. Concurrency & Race Verification

The integration test suite explicitly verifies SQLite atomic updates:

```typescript
// From packages/server/test/approval-integration.test.ts
const [resApprove, resDeny] = await Promise.all([
  fetch(`${serverUrl}/approvals/${id}/approve`, { method: 'POST', body: ... }),
  fetch(`${serverUrl}/approvals/${id}/deny`, { method: 'POST', body: ... }),
]);

// One request gets 200 OK, the other gets 409 Conflict
expect([resApprove.status, resDeny.status].sort()).toEqual([200, 409]);

// Database contains exactly ONE approval.resolved event
const resolvedEvents = repo.getEventsBySession(sessionId).filter(e => e.type === 'approval.resolved');
expect(resolvedEvents.length).toBe(1);
```
