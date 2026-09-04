# Security Model & Universal Agent Control Boundary (V0.3)

Agent Monitor provides a **deterministic control plane, pre-execution risk analysis, MCP proxy interception, and human approval gates** for AI coding agents.

---

## 1. Non-Negotiable Core Security Invariant

For every external agent or tool action that can cause filesystem, process, network, or other side effects:

```text
REQUEST
  ↓
KILL SWITCH CHECK
  ↓
NORMALIZATION
  ↓
WORKSPACE / GUARDRAIL VALIDATION
  ↓
RISK ANALYSIS
  ↓
POLICY EVALUATION
  ↓
HUMAN APPROVAL IF ASK
  ↓
POST-APPROVAL KILL SWITCH CHECK
  ↓
EXECUTION
  ↓
RESULT INSPECTION
  ↓
SQLITE PERSISTENCE
  ↓
CLIENT RESPONSE
```

No tool or resource read can bypass any step in this chain.

---

## 2. Guardrails & Containment

### A. Workspace Path Normalization & Containment

All file-based actions (`file.read`, `file.write`, `file.list`, `resources/read`) are resolved against the designated `workspaceRoot`.

- **RFC 8089 URI Normalization**: Resource reads with `file://` URIs are normalized using standard Node.js `fileURLToPath()`, resolving explicit `file://localhost/...` paths to local absolute paths. Any remote host, invalid IP host (`file://127.0.0.1/...`), UNC network share, or non-file scheme (`s3://...`) fails closed and is flagged as an external path outside the workspace.
- **Component-Aware Traversal Normalization**: Handles POSIX forward slashes, Windows backslashes (`\ -> /`), and iterative URL-encoded traversals (`%2e%2e%2f` and `%252e%252e%252f`).
- Paths resolving outside the workspace root (e.g. `../../etc/passwd` or `subdir\..\..\..\etc\passwd`) are flagged with `isOutsideWorkspace: true`.
- The built-in policy `deny-outside-workspace` immediately blocks any action resolving outside the workspace with `DENY`.

### B. Symlink Escape Verification

- For existing files and folders, `fs.realpathSync` resolves symbolic links to verify that targets remain strictly within the workspace root.
- If a symlink points to an external path (e.g. `/etc` or `~/.ssh`), it is blocked with `DENY`.

### C. Child Process Environment Sanitization

- Executed commands do not inherit parent environment variables containing sensitive secrets, API keys, tokens, or credentials (`KEY`, `TOKEN`, `SECRET`, `AUTH`, `PASS`, `CREDENTIAL`).
- Only sanitized system variables (`PATH`, `HOME`, `SHELL`, `LANG`, `TMPDIR`, `TERM`) are forwarded.

---

## 3. Universal MCP Stdio Proxy Guardrails

### A. Strict Byte-Buffer JSON-RPC Framing

- The MCP stdio proxy operates on pure Node.js byte buffers (`Buffer`), eliminating character-count vs. byte-length desynchronization attacks on multi-byte UTF-8 sequences.
- `Content-Length` headers are strictly validated: non-numeric, negative, and oversized (`> 10MB`) lengths are rejected, clearing the desynchronized buffer to prevent HTTP/RPC request smuggling.

### B. Universal Control Plane Interception

- Both `tools/call` and `resources/read` are intercepted and routed through the control boundary.
- File URIs (`file:///...`) and relative resource paths are extracted, normalized, and validated against workspace boundaries.

### C. Tool Fingerprinting & Schema Rug-Pull Detection

- External tool definitions from `tools/list` are SHA-256 fingerprinted and persisted in SQLite.
- **Multi-Server Isolation**: Tool fingerprints are uniquely tracked by `(session_id, tool_name, source)`. In multi-server sessions, an unmutated tool on one server never shadows a mutated tool with the same name on another server.
- If a downstream MCP server dynamically mutates tool schema or parameters at runtime (a tool rug-pull), the tool is flagged as mutated and requires mandatory human approval (`ask-mutated-tools`).

### D. Result Inspection & Leak Prevention

- Responses from downstream MCP tools and resources are inspected prior to returning to the agent.
- Cryptographic private keys (`BEGIN RSA/EC/DSA/OPENSSH/PGP PRIVATE KEY`) are detected and flagged.
- Oversized outputs are safely truncated to 500KB to protect memory integrity.

---

## 4. Authoritative Local Circuit Breaker (Kill Switch)

- The operator kill switch is maintained authoritatively in SQLite.
- Checked both prior to policy evaluation and immediately post-approval to eliminate race conditions.
- When activated, all pending and incoming tool executions and resource reads are immediately rejected with `action.blocked`.

---

## 5. Local Server CORS & Origin Hardening

- The MonitorServer REST/SSE endpoints restrict cross-origin requests.
- Requests with untrusted external `Origin` headers (e.g. `https://evil.com`) are rejected with `403 Forbidden` to prevent malicious browser-based drive-by commands.
- Local origins (`localhost`, `127.0.0.1`, `[::1]`) and direct non-browser requests (CLI, curl) are permitted.

---

## 6. Behavioral Sequence Engine & Data Flow Analysis

- Detects multi-step exfiltration flows that appear benign in isolation (e.g. reading credentials from `.env`, followed by an outbound network call or child process execution).
- Correlates historical actions across session state using a strictly bounded sliding window (`MAX_BEHAVIORAL_RECORDS = 200`) to guarantee deterministic memory consumption during runtime and SQLite event rehydration.
- Integrates directly with PolicyEngine via `when.priorSensitiveRead` and `when.priorWorkspaceWrite` contextual rules.
