# Security Model & Universal Agent Control Boundary (V4.1.0)

Agent Monitor provides a **deterministic control plane, pre-execution risk analysis, MCP proxy interception, cryptographic audit integrity, and automated security operations** for autonomous AI coding agents.

---

## 1. Non-Negotiable Core Security Invariant

For every agent action or tool call that can cause filesystem, process, network, or external side effects:

```text
 1. INGRESS REQUEST & PAYLOAD BOUNDS (10MB JSON-RPC frame, 1MB arguments)
   ↓
 2. KILL SWITCH (Authoritative SQLite WAL Check)
   ↓
 3. SOURCE QUARANTINE (Sticky SQLite Containment)
   ↓
 4. RATE LIMITING (Sliding Window Flood Prevention)
   ↓
 5. ACTION NORMALIZATION (RFC 8089 URI Canonicalization)
   ↓
 6. WORKSPACE / GUARDRAIL VALIDATION (Unicode NFC, Null-Byte, Symlink, Drive/UNC)
   ↓
 7. RISK ASSESSMENT & SCHEMA MUTATION CHECK (0–100 CWE Heuristics)
   ↓
 8. DETERMINISTIC POLICY EVALUATION (Additive Specificity: DENY > ASK > ALLOW)
   ↓
 9. HUMAN APPROVAL IF ASK (Terminal / Web UI)
   ↓
10. POST-APPROVAL COMPREHENSIVE REVALIDATION
    - Action Context Hash Match (Tamper / Substitution Resistance)
    - Approval Expiration Check (Timeout Invalidation)
    - Active Policy Version Match (No Stale Approvals)
    - Post-Approval Kill Switch & Quarantine Re-Check
   ↓
11. CONTROLLED DOWNSTREAM EXECUTION (Bounded Timeouts & Idempotency)
   ↓
12. RESULT & EXFILTRATION INSPECTION (Deep Secret Redaction & 500KB Bound)
   ↓
13. SQLITE WAL PERSISTENCE WITH SHA-256 HASH CHAINING
   ↓
14. AUTOMATIC INCIDENT ESCALATION & DISPATCH
```

No tool, MCP call, or resource read can bypass any step in this chain.

---

## 2. Guardrails & Containment

### A. Workspace Path Normalization & Containment
All file-based actions (`file.read`, `file.write`, `file.list`, `resources/read`) are resolved against the designated `workspaceRoot`.
- **RFC 8089 URI Normalization**: Resource reads with `file://` URIs are normalized using standard Node.js `fileURLToPath()`. Any remote host, invalid IP host (`file://127.0.0.1/...`), UNC network share, or non-file scheme fails closed and is blocked outside the workspace.
- **Null Byte Injection Defense**: Traversal paths containing `\0` (raw or multi-pass URL-encoded) are immediately blocked.
- **Multi-Pass URL-Encoding Resolution**: Iteratively decodes up to 5 layers of nested URL encodings (e.g. `%252e%252e%252f`).
- **Unicode NFC Normalization**: Normalizes path strings to Unicode NFC to defeat visual spoofing and canonicalization bypasses.
- **Cross-Platform Drive & UNC Containment**: Windows drive letters (`C:\...`) and network UNC shares (`\\server\share`) are explicitly isolated and rejected on POSIX systems.

### B. Symlink Escape Verification
- For existing files and folders, `fs.realpathSync` resolves symbolic links to verify that targets remain strictly within the workspace root.
- If a symlink points to an external path (e.g. `/etc` or `~/.ssh`), it is blocked with `DENY`.
- Circular symlink loops are safely bounded without recursion traps.

### C. Child Process Environment Sanitization
- Executed commands do not inherit parent environment variables containing sensitive secrets, API keys, tokens, or credentials (`KEY`, `TOKEN`, `SECRET`, `AUTH`, `PASS`, `CREDENTIAL`).
- Only sanitized system variables (`PATH`, `HOME`, `SHELL`, `LANG`, `TMPDIR`, `TERM`) are forwarded.

---

## 3. Human Approval Security & Context Binding

### A. Action Context Hash Binding
When an approval request is generated for an action requiring human approval (`ASK`), an immutable SHA-256 context hash is computed:
```text
actionContextHash = SHA-256(canonicalizeJson({
  sessionId, actionKind, params, source, policyVersion, riskScore
}))
```
During post-approval revalidation prior to execution, the context hash is recomputed and strictly matched. Any modification to parameters, target files, or commands during the pending window aborts execution immediately.

### B. Approval Expiration Invalidation
Approvals are bound to a strict expiration timestamp (`expiresAt = Date.now() + timeoutMs`). Stale approvals cannot be executed after expiry.

### C. Policy Version Invalidation
If the active policy version changes while an approval is pending, the approval is invalidated, forcing the action to be re-evaluated under the current policy version.

---

## 4. Universal MCP Stdio Proxy Guardrails

### A. Strict Byte-Buffer JSON-RPC Framing
- Operates on pure Node.js byte buffers (`Buffer`), eliminating character-count vs. byte-length desynchronization attacks on multi-byte UTF-8 sequences.
- Bounded framing: non-numeric, negative, and oversized (`> 10MB`) Content-Length headers are rejected immediately.
- 1MB payload ceiling on incoming tool arguments.

### B. Sticky MCP Source Quarantine & Trust Lifecycle
- Any compromised, rogue, or mutating MCP server can be isolated into `QUARANTINED` status.
- Once quarantined, all incoming requests from that source are rejected fail-closed immediately.
- Quarantine status is persistent in SQLite across process restarts and proxy reconnections.

### C. Deep Result Inspection & Sensitive Secret Redaction
- Responses from downstream MCP tools and resources are inspected prior to returning to the agent.
- Automatically redacts API keys, AWS credentials, JWT tokens, and private SSH/TLS keys, replacing them with `[REDACTED:<type>]`.
- Oversized outputs exceeding 500KB are safely truncated with warning metadata.

---

## 5. Authoritative Local Circuit Breaker (Kill Switch)
- Maintained authoritatively in SQLite WAL storage.
- Checked both prior to policy evaluation and immediately post-approval to eliminate race conditions.
- When activated, all pending and incoming tool executions and resource reads are immediately rejected.

---

## 6. Cryptographic Hash Chaining & Audit Log Integrity
- Every event written to the SQLite `events` table includes `hash` and `prev_hash` columns.
- Deterministically computed using SHA-256 over recursive canonical JSON (`canonicalizeJson`).
- Strict sequence monotonicity: sequence must start at 1 with null `prev_hash` (genesis) and increment monotonically with zero gaps or duplicates.
- The `agent-monitor audit verify` command traverses the entire historical chain to cryptographically prove that zero records have been deleted, inserted, or altered.
