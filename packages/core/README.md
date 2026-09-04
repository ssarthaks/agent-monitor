# `@agent-monitor/core`

Core domain models, event interfaces, deterministic risk analysis, and additive policy engine for Agent Monitor.

---

## Overview

`@agent-monitor/core` is the foundational, **zero-dependency** package containing pure TypeScript definitions and deterministic algorithms for observing and controlling AI agents.

---

## Key Modules

- **`normalization/`**:
  - `ActionNormalizer`: Canonical action mapping from arbitrary MCP tool calls, raw process commands, and resource URIs into strongly-typed action intents.
- **`behavior/`**:
  - `BehavioralEngine`: Correlates multi-step action sequences across a session (`SEC_MUTATION_TO_READ`, `SEC_TRAVERSAL_TO_EXEC`, `SEC_DENIAL_TO_ALTERNATIVE`, `SEC_SENSITIVE_TO_NETWORK`) with sliding window memory bounds.
- **`fingerprint/`**:
  - `computeToolFingerprint`: Cryptographic SHA-256 fingerprinting of external tool schemas for runtime mutation (rug-pull) detection.
- **`policy/`**:
  - `PolicyEngine`: Synchronous evaluation engine with additive rule specificity.
  - `versioning`: Policy version models, immutable SHA-256 content hashing, diff computation, and rollbacks.
  - `matcher`: Glob and command pattern matching (`**/*.secret`, `git push *`).
  - `defaults`: Built-in default secure rules (`ALLOW`, `DENY`, `ASK`).
- **`risk/`**:
  - `RiskAnalyzer`: Evaluates pre-execution risk scores (0–100) mapped to CWE categories.
  - `SessionRiskEngine`: Aggregates multi-action session risk with factor explainability breakdown.
- **`incidents/`**:
  - `SecurityIncident`: Case model, severity levels, triage status, and correlated event schema.
- **`audit/`**:
  - `computeEventHash`, `verifyEventChain`: Cryptographic SHA-256 event hash chaining and tamper detection.
- **`mcp/`**:
  - Downstream MCP source interfaces, health metrics, and quarantine status.
- **`events/`**:
  - Complete domain event types and cryptographic hash chaining interfaces.
- **`actions/`**:
  - Canonical action models (`ActionKind`, `ActionCategory`).
- **`approvals/`**:
  - Approval status and request types.


---

## Installation

```bash
npm install @agent-monitor/core
```

---

## Example Usage

### Evaluating a Policy:

```typescript
import { PolicyEngine } from "@agent-monitor/core";

const engine = new PolicyEngine();
const result = engine.evaluate(
  { kind: "process.exec", params: { command: "git push origin main" } },
  { workspaceRoot: process.cwd() },
);

console.log(result.decision); // 'ASK'
console.log(result.reason); // 'Pushing changes to a remote repository requires human approval.'
```

### Analyzing Risk:

```typescript
import { RiskAnalyzer } from "@agent-monitor/core";

const analyzer = new RiskAnalyzer();
const risk = analyzer.analyze("file.read", { path: ".env" });

console.log(risk.score); // 40
console.log(risk.level); // 'HIGH'
```
