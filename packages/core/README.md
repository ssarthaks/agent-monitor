# `@agent-monitor/core`

Core domain models, event interfaces, deterministic risk analysis, and additive policy engine for Agent Monitor.

---

## Overview

`@agent-monitor/core` is the foundational, **zero-dependency** package containing pure TypeScript definitions and deterministic algorithms for observing and controlling AI agents.

---

## Key Modules

- **`policy/`**:
  - `PolicyEngine`: Synchronous evaluation engine with additive rule specificity.
  - `matcher`: Glob and command pattern matching (`**/*.secret`, `git push *`).
  - `defaults`: Built-in default secure rules (`ALLOW`, `DENY`, `ASK`).
- **`risk/`**:
  - `RiskAnalyzer`: Evaluates pre-execution risk scores (0–100) mapped to CWE categories.
- **`events/`**:
  - Complete domain event types (`session.*`, `policy.evaluated`, `approval.*`, `action.*`).
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
