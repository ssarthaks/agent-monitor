# Adversarial Testing & Verification Suite (V4.1.0)

This document details the adversarial test suites, fuzzing harnesses, and performance benchmarks implemented in **Agent Monitor V4.1.0**.

---

## 1. Test Suite Architecture

Agent Monitor maintains **34 test suites** containing **202 tests** passing at 100% with zero regressions.

```text
packages/
├── agent/test/
│   ├── adversarial-filesystem.test.ts  (26 tests: null bytes, Windows drives, UNC, URL encodings, symlinks, URI schemes, case-insensitivity)
│   ├── approval-hardening.test.ts      (5 tests: hash mismatch, expiration, policy version changes, kill races)
│   ├── fuzz-path-resolver.test.ts      (3 tests: 500+ randomized mutation fuzzing iterations)
│   └── ... (original test suites)
├── gateway/test/
│   ├── adversarial-mcp.test.ts         (4 tests: quarantine enforcement, rug-pull mutations, notification bypass)
│   ├── resource-exhaustion.test.ts     (5 tests: 1MB arguments, 500KB truncation, secret redaction, buffer limits, valid JSON bounds)
│   ├── fuzz-jsonrpc.test.ts            (4 tests: chunk fragmentation, random bytes, malformed framing)
│   └── ... (original test suites)
└── server/test/
    ├── adversarial-audit.test.ts       (10 tests: sequence gaps, duplicates, forged prevHash, tampering, secret persistence, canary test)
    ├── benchmarks.test.ts              (3 tests: hash chaining, policy evaluation, path normalization throughput)
    ├── migrations.test.ts              (4 tests: schema migrations, idempotency, V0.3 upgrade, corruption fail-closed)
    └── ... (original test suites)
```

---

## 2. Adversarial Filesystem Security Tests

Located in [`packages/agent/test/adversarial-filesystem.test.ts`](../packages/agent/test/adversarial-filesystem.test.ts).

### Verified Attack Vectors:
- **Null Byte Injections**:
  - Raw null bytes: `safe.txt\0/../../etc/passwd`
  - Single URL-encoded: `safe.txt%00.png`
  - Multi-layer URL-encoded: `safe.txt%2500.png`
- **Windows Drive Letters on POSIX**:
  - `C:\Windows\System32\cmd.exe`
  - `D:/data/secrets.env`
  - Case-insensitive drive variations (`c:\boot.ini`)
- **UNC Remote Shares**:
  - Network share paths: `\\attacker-smb\share\evil.exe`
  - Mixed slash UNC: `//192.168.1.100/c$/secrets.txt`
- **Multi-Pass URL-Encoded Traversals**:
  - Single: `%2e%2e%2f%2e%2e%2fetc%2fpasswd`
  - Double: `%252e%252e%252f%252e%252e%252fetc%2fpasswd`
  - Triple: `%25252e%25252e%25252f%25252e%25252e%25252fetc%2fpasswd`
  - Mixed slashes and encoding: `..%5c..%2fetc/passwd`
- **Symlink Escape Traps**:
  - Symlinks pointing outside `workspaceRoot` detected and blocked via `fs.realpathSync`.
  - Circular symlink loops handled safely without infinite recursion or stack overflows.

---

## 3. Approval Context Binding & Race Resistance

Located in [`packages/agent/test/approval-hardening.test.ts`](../packages/agent/test/approval-hardening.test.ts).

### Verified Mitigations:
- **Action Parameter Tampering**:
  If parameters are modified between the time human approval was requested and when it executes, `computeActionContextHash` detects the divergence and throws:
  `Security Violation: Action context hash mismatch between approval and execution`
- **Approval Expiration**:
  Approvals past their `expiresAt` window fail immediately at post-approval check.
- **Policy Version Invalidation**:
  If policies are modified or rolled back while an approval is pending, the post-approval check aborts execution and forces re-evaluation under the active policy version.
- **Kill Switch Race Condition**:
  If an operator triggers `agent-monitor kill` while an action was pending or just approved, post-approval revalidation halts execution immediately.

---

## 4. Cryptographic Audit Tamper Resistance

Located in [`packages/server/test/adversarial-audit.test.ts`](../packages/server/test/adversarial-audit.test.ts).

### Verified Integrity Violations:
- **Sequence Gaps**: Chains with missing intermediate sequence numbers fail with `Sequence monotonicity violation`.
- **Duplicate Sequences**: Multiple events with the same sequence number fail.
- **Genesis Sequence Violation**: Chains not starting with sequence 1 fail with `Genesis violation`.
- **Genesis prevHash Violation**: Sequence 1 having non-null `prevHash` fails.
- **Forged prevHash**: Intermediate events pointing to invalid hashes fail with `prevHash mismatch`.
- **Direct Database Payload Tampering**: Modifying `payload_json` in SQLite directly is caught via SHA-256 mismatch:
  `Hash integrity violation at sequence N: recomputed hash does not match recorded hash`
- **Canonical Serialization**: `canonicalizeJson` guarantees identical hashes regardless of object key insertion order.

---

## 5. Fuzzing & Mutation Tests

- **JSON-RPC Stream Fuzzer** ([`packages/gateway/test/fuzz-jsonrpc.test.ts`](../packages/gateway/test/fuzz-jsonrpc.test.ts)):
  Feeds 200+ randomized binary chunks, malformed headers, and arbitrary byte sequences to ensure zero unhandled exceptions and reliable stream recovery.
- **Workspace Path Resolver Fuzzer** ([`packages/agent/test/fuzz-path-resolver.test.ts`](../packages/agent/test/fuzz-path-resolver.test.ts)):
  Evaluates 500 random permutations of path characters, traversal tokens, null bytes, unicode emojis, and separators.

---

## 6. Performance Benchmarks

Located in [`packages/server/test/benchmarks.test.ts`](../packages/server/test/benchmarks.test.ts).

| Benchmark Operation | Target Throughput | Measured Throughput | Status |
|---|---|---|---|
| **Cryptographic Hash Chaining** | > 5,000 events/sec | ~25,000 events/sec | PASS |
| **Deterministic Policy Evaluation** | > 20,000 eval/sec | ~120,000 eval/sec | PASS |
| **Workspace Path Normalization** | > 40,000 checks/sec | ~200,000 checks/sec | PASS |

---

## 7. Running the Test Suite

Execute the entire test suite across all 5 packages:

```bash
npm test
```
