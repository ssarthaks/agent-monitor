# Security Incident Response Guide (V4.1.0)

This runbook describes how security operators, SREs, and developers triage, investigate, contain, and resolve security incidents flagged by **Agent Monitor**.

---

## 1. Incident Lifecycle Overview

Agent Monitor automatically creates security incidents when high-risk policy violations, behavioral sequence alerts, or source mutations occur.

```text
┌─────────────────┐
│     OPEN        │ ◄── Automated creation on CRITICAL / HIGH event
└────────┬────────┘
         │ Operator acknowledges & starts investigation
         ▼
┌─────────────────┐
│  INVESTIGATING  │ ◄── Triage in Web UI or CLI
└────────┬────────┘
         │ Operator applies Kill Switch or Quarantines Source
         ▼
┌─────────────────┐
│   CONTAINED     │ ◄── Malicious activity halted; environment secured
└────────┬────────┘
         │ Root cause remediated & verified
         ▼
┌─────────────────┐
│    RESOLVED     │ ◄── Case documented and closed
└─────────────────┘
```

---

## 2. CLI Incident Management Commands

### 2.1 Listing Active Incidents

List all uncontained critical and high severity incidents:

```bash
agent-monitor incidents list --status OPEN --severity CRITICAL
```

Output as pure JSON for SIEM / automation pipelines:

```bash
agent-monitor incidents list --status OPEN --json
```

### 2.2 Inspecting Incident Details & Forensic Events

View full details of an incident including correlated action parameters:

```bash
agent-monitor incidents show <incident-id>
```

Retrieve the chronological sequence of correlated audit events leading up to the trigger:

```bash
agent-monitor incidents events <incident-id>
```

### 2.3 Updating Incident Status & Adding Triage Notes

Transition an incident to `INVESTIGATING`:

```bash
agent-monitor incidents update <incident-id> \
  --status INVESTIGATING \
  --notes "Operator triaging suspicious curl request"
```

---

## 3. Emergency Containment Procedures

### 3.1 Activating Session Kill Switch

If an agent is behaving erratically or attempting unauthorized operations, activate the circuit breaker immediately:

```bash
agent-monitor kill --session <session-id> --reason "Suspicious exfiltration attempt"
```

- Blocks all subsequent tool calls and executions instantly.
- Any pending human approval is invalidated.
- Execution cannot resume until an operator explicitly runs:
  ```bash
  agent-monitor resume --session <session-id>
  ```

### 3.2 Quarantining an Untrusted MCP Source

If an MCP server mutates its tools or leaks credentials, quarantine it across the entire environment:

```bash
agent-monitor mcp quarantine <source-id> --reason "Runtime schema mutation detected"
```

- Persists sticky quarantine status in SQLite.
- MCP gateway will fail-closed and reject all tool calls and resource reads from this server.
- Server remains blocked across process restarts until an operator explicitly trusts it:
  ```bash
  agent-monitor mcp trust <source-id>
  ```

---

## 4. Post-Incident Review & Resolution

1. **Verify Audit Trail Integrity**:
   Run cryptographic audit verification to ensure logs were not tampered with during the incident:
   ```bash
   agent-monitor audit verify
   ```
2. **Export Canonical Audit Ledger**:
   Export deterministic audit ledger for compliance and forensic archiving:
   ```bash
   agent-monitor audit export --session <session-id> --output incident-evidence.json
   ```
3. **Resolve the Incident Case**:
   ```bash
   agent-monitor incidents update <incident-id> \
     --status RESOLVED \
     --notes "Root cause identified as outdated policy. Rule updated and verified."
   ```
