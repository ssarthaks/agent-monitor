# Actions & Safe Tools Reference

An **Action** represents a distinct intent or operation requested by an AI agent (such as reading a file or executing a shell command).

---

## 1. Action Model

Every action intercepted by Agent Monitor is categorized by an **ActionKind** and an **ActionCategory**:

```typescript
export type ActionCategory = "file" | "process" | "network" | "custom";

export type ActionKind =
  | "file.read"
  | "file.write"
  | "file.list"
  | "file.delete"
  | "process.exec"
  | "network.http"
  | string;
```

---

## 2. Standard Safe Tools (V0.2)

Agent Monitor provides 4 built-in safe tools equipped with guardrails:

### 1. `readFileTool` (`file.read`)

Reads UTF-8 text files within the workspace.

- **Category**: `file`
- **Parameters**:
  - `path` (`string`, required): Relative or workspace-contained absolute file path.
- **Guardrails**: Workspace boundary validation, `.env` / SSH key risk detection, max 5MB file limit.
- **Metadata Produced**: `bytesProcessed`.

### 2. `writeFileTool` (`file.write`)

Creates or replaces files within the workspace and computes unified diffs.

- **Category**: `file`
- **Parameters**:
  - `path` (`string`, required): Target file path.
  - `content` (`string`, required): New file content.
- **Guardrails**: Workspace boundary validation, parent directory creation, max 5MB payload limit.
- **Metadata Produced**: `diff` (unified diff string), `linesChanged` (`added`, `removed`), `bytesProcessed`.

### 3. `listFilesTool` (`file.list`)

Lists files and directories recursively or at the top level.

- **Category**: `file`
- **Parameters**:
  - `path` (`string`, optional): Sub-directory to inspect (default: `.`).
  - `recursive` (`boolean`, optional): Whether to recurse sub-directories (default: `false`).
- **Guardrails**: Automatically ignores `node_modules`, `.git`, `.agent-monitor`, `.next`, and `dist`.

### 4. `runCommandTool` (`process.exec`)

Executes shell commands in a child process.

- **Category**: `process`
- **Parameters**:
  - `command` (`string`, required): Shell command string.
  - `cwd` (`string`, optional): Working directory relative to workspace root.
  - `timeoutMs` (`number`, optional): Execution timeout (default: 60,000ms).
- **Guardrails**: Risk analysis for destructive deletes (`rm -rf`), privilege escalation (`sudo`), outbound network (`curl`), and output size capping (500KB).
- **Metadata Produced**: `exitCode`.

---

## 3. Tool Registration & Interception

Tools are registered with the `ActionInterceptor`:

```typescript
import {
  ActionInterceptor,
  readFileTool,
  writeFileTool,
  listFilesTool,
  runCommandTool,
} from "@agent-monitor/agent";

const interceptor = new ActionInterceptor({
  sink,
  policyEngine,
  approvalManager,
});

interceptor.registerTool(readFileTool);
interceptor.registerTool(writeFileTool);
interceptor.registerTool(listFilesTool);
interceptor.registerTool(runCommandTool);
```

When an agent invokes a tool:

```typescript
const result = await interceptor.invoke(
  "run_command",
  { command: "npm test" },
  context,
);
```

The interceptor automatically applies containment checks, computes risk, evaluates policies, gates on human approval if needed, and logs all events.
