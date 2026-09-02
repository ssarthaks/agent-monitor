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

## 2. Test Suite Architecture

| Test Suite                            | Location                                            | Scope                                                                                            |
| :------------------------------------ | :-------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **Policy Engine Tests**               | `packages/core/test/policy-engine.test.ts`          | Specificity calculation, rule precedence, root-level vs nested glob matching (`**/*.secret`).    |
| **Risk Analyzer Tests**               | `packages/core/test/risk-analyzer.test.ts`          | Heuristic vector checks (`SEC_DOTENV`, `CMD_DESTRUCTIVE_RM`, `PATH_TRAVERSAL`).                  |
| **Approval Repository Tests**         | `packages/server/test/approval-repository.test.ts`  | SQLite CRUD, atomic conditional update (`status = 'pending'`), expiry queries.                   |
| **Server & API Tests**                | `packages/server/test/server.test.ts`               | REST endpoints, SSE stream subscription, session creation.                                       |
| **Approval API Tests**                | `packages/server/test/approval-api.test.ts`         | `/approvals/:id/approve` and `/deny` routes, HTTP 409 Conflict handling.                         |
| **Approval Integration & Race Tests** | `packages/server/test/approval-integration.test.ts` | Single authoritative event emission, approve vs deny races, dynamic agentId derivation.          |
| **Tools & Guardrails Tests**          | `packages/agent/test/tools.test.ts`                 | Path containment, symlink checks, diff generation, command execution timeouts.                   |
| **Interceptor Policy Tests**          | `packages/agent/test/interceptor-policy.test.ts`    | Strict event sequencing across `ALLOW`, `DENY`, `ASK+approved`, `ASK+denied`, and `ASK+expired`. |
| **DeepSeek Mock Tests**               | `packages/agent/test/deepseek-mock.test.ts`         | Mocked agent prompt-and-tool loop execution.                                                     |
| **CLI Commands Tests**                | `packages/cli/test/cli-commands.test.ts`            | `config init`, `--force` overwriting, config validation.                                         |

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
