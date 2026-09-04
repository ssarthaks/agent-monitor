# Disaster Recovery & System Restoration Guide (V4.1.0)

This guide provides procedures for recovering Agent Monitor after unexpected system crashes, storage corruption, network interruptions, or erroneous policy updates.

---

## 1. Crash & Abrupt Termination Recovery

### 1.1 Automatic WAL Crash Recovery
SQLite WAL mode guarantees atomicity and durability. If the host machine reboots or the monitor process is killed with `SIGKILL`:
1. On startup, SQLite automatically reads `data.db-wal`.
2. Any completed transactions are rolled forward into `data.db`.
3. Any partial, uncommitted write transactions are discarded cleanly.
4. Foreign key constraints remain valid.

### 1.2 Lingering Pending Approvals
If a process crashes while human approval requests were pending:
- On startup, the server marks lingering pending approvals past their expiration as `expired`.
- Operators can list pending approvals:
  ```bash
  agent-monitor approvals list
  ```

---

## 2. Cryptographic Audit Log Recovery & Tamper Investigation

If `agent-monitor audit verify` fails with exit code 3:

```text
❌ Session ses_example: TAMPER DETECTED / BROKEN CHAIN
   Failed at Sequence #42
   Reason: Hash integrity violation at sequence 42
```

### Investigation Procedure:
1. **Identify the exact sequence failure**:
   Note the `brokenAtSequence` from the verification output.
2. **Export the canonical ledger for offline analysis**:
   ```bash
   agent-monitor audit export --session <session-id> --output broken-chain.json
   ```
3. **Inspect the database row**:
   ```bash
   sqlite3 .agent-monitor/data.db "SELECT id, sequence, prev_hash, hash, payload_json FROM events WHERE session_id = '<session-id>' AND sequence BETWEEN 40 AND 44;"
   ```
4. **Determine whether failure was caused by tampering or pre-V4 legacy data**:
   Sessions created prior to V4.0.0 will naturally lack cryptographic hashes.

---

## 3. Policy Version Rollback

If a newly deployed policy rule inadvertently blocks critical agent operations, roll back immediately to a known safe version:

1. **List all historical policy versions**:
   ```bash
   agent-monitor policy versions
   ```
2. **Diff active version with target version**:
   ```bash
   agent-monitor policy diff <target-version> <active-version>
   ```
3. **Execute instant rollback**:
   ```bash
   agent-monitor policy rollback <target-version>
   ```
   - Rollback executes atomically in SQLite.
   - Updates `agent-monitor.config.json` on disk.
   - Broadcasts policy update event to all active sessions.

---

## 4. Recovering from Database Corruption

If SQLite reports page errors during `PRAGMA integrity_check`:

1. **Stop all active agents and the monitor server**:
   ```bash
   pkill -f "agent-monitor"
   ```
2. **Dump salvageable data**:
   ```bash
   sqlite3 .agent-monitor/data.db ".dump" > /tmp/salvage.sql
   ```
3. **Restore into fresh database**:
   ```bash
   mv .agent-monitor/data.db .agent-monitor/data.db.corrupted
   sqlite3 .agent-monitor/data.db < /tmp/salvage.sql
   ```
4. **Verify restored database health**:
   ```bash
   agent-monitor health
   ```
