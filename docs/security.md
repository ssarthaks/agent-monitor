# Security Model & Guardrails

Agent Monitor provides **deterministic safety guardrails, pre-execution risk analysis, and human approval gates** for AI agents.

---

## 1. Security Architecture Overview

Agent Monitor operates as an **interception layer** between the autonomous agent and the host operating system.

```text
AI Tool Request
      │
      ▼
[ Workspace Containment ]  ──► Path Traversal? Symlink Escape? (Blocked if outside)
      │
      ▼
[ Deterministic Risk ]     ──► Analyzes 8 CWE Vectors (Scores 0–100)
      │
      ▼
[ Policy Engine ]          ──► Evaluates Specificity & Safety Precedence (ALLOW / ASK / DENY)
      │
      ▼
[ Human Approval Gate ]    ──► Genuinely pauses on ASK (Terminal / Web UI)
      │
      ▼
[ Tool Execution ]         ──► Executes tool with timeout & output caps
```

---

## 2. Guardrails & Containment

### A. Workspace Path Normalization & Containment

All file-based actions (`file.read`, `file.write`, `file.list`) are resolved against the designated `workspaceRoot`.

- `resolveSafeWorkspacePath` resolves `..` segments and compares the absolute canonical path against `workspaceRoot`.
- Paths resolving outside the workspace root (e.g. `../../etc/passwd`) are flagged with `isOutsideWorkspace: true`.
- The built-in policy `deny-outside-workspace` immediately blocks any action resolving outside the workspace with `DENY`.

### B. Symlink Verification

- For existing files and folders, `fs.realpathSync` resolves symbolic links to ensure the symlink target remains strictly within the workspace directory.
- If a symlink points to an external path (e.g. `/etc` or `~/.ssh`), it is classified as outside the workspace boundary.

### C. Resource & Output Limits

- **File Operations**: Maximum read/write size limit (default: 5MB) prevents memory exhaustion.
- **Process Execution**: Command execution has a strict timeout (default: 60s) and stdout/stderr output caps (default: 500KB) to prevent runaway loops.

---

## 3. Deterministic Risk Analysis (CWE Mapping)

Before policy evaluation, the `RiskAnalyzer` computes a numeric risk score (**0 to 100**) mapped to Common Weakness Enumerations (CWE):

| Rule ID                    | Vector           | Severity   | Score | CWE ID  | Description                                                   |
| :------------------------- | :--------------- | :--------- | :---: | :------ | :------------------------------------------------------------ |
| `SEC_DOTENV`               | Dotenv Access    | `HIGH`     |  40   | CWE-200 | Reading or writing `.env` files containing secrets.           |
| `SEC_SSH_KEYS`             | SSH Keys         | `CRITICAL` |  80   | CWE-522 | Accessing `~/.ssh` or private key files (`id_rsa`, `.pem`).   |
| `SEC_CREDENTIALS`          | Credentials      | `HIGH`     |  50   | CWE-798 | Accessing files named `credentials`, `secrets.json`, `.aws/`. |
| `CMD_DESTRUCTIVE_RM`       | Recursive Delete | `CRITICAL` |  60   | CWE-73  | Executing `rm -rf` on root or wildcard targets.               |
| `CMD_PRIVILEGE_ESCALATION` | Sudo / Su        | `CRITICAL` |  75   | CWE-250 | Executing `sudo`, `su`, or `chown root`.                      |
| `CMD_NETWORK_OUTBOUND`     | Network Download | `MEDIUM`   |  25   | CWE-494 | Executing `curl`, `wget`, `nc`, or `ssh`.                     |
| `PATH_TRAVERSAL`           | Path Traversal   | `CRITICAL` |  90   | CWE-22  | Attempting to access files outside the workspace root.        |
| `GIT_INTERNAL_ACCESS`      | Git Internals    | `LOW`      |  15   | CWE-200 | Direct access to `.git/` internal objects.                    |

---

## 4. Honest Security Boundaries & Limitations

> [!IMPORTANT]
> **Agent Monitor V0.2 is a deterministic policy gate and developer control plane — it is NOT an OS-level virtualization sandbox (such as Docker, gVisor, or MicroVMs).**

### What Agent Monitor Protects Against:

- ✅ Accidental or hallucinated reads of `.env` files and SSH keys.
- ✅ Accidental `git push` or destructive `rm -rf` commands during automated workflows.
- ✅ Direct path traversal escapes via relative paths (`../../etc/passwd`).
- ✅ Unmonitored or silent agent mutations without human awareness.

### What Agent Monitor Does NOT Protect Against (Threat Model):

- ❌ **Obfuscated Shell Attacks**: A command like `bash -c "$(echo cm0gLXJmIC8= | base64 -d)"` executes via bash. (Process-level sandboxing is planned for future versions).
- ❌ **Adversarial Kernel Exploits**: Agent Monitor runs with the permissions of the host user running the CLI.
- ❌ **Network Layer Evasion**: Non-shell outbound network calls initiated by external binaries.
