# Policy Engine & Specificity Model

The **Agent Monitor Policy Engine** evaluates agent actions before execution and decides whether the action should be:

- **`ALLOW`**: Permitted to execute immediately.
- **`DENY`**: Blocked immediately with zero tool execution.
- **`ASK`**: Paused until human approval is granted via the Terminal or Web UI.

---

## 1. Additive Specificity Model

When an action is evaluated against multiple matching policy rules, the rule with the **highest numerical specificity score** wins.

Specificity is computed as the sum across four orthogonal dimensions:

| Dimension      | Matching Criteria                                                                     | Score   |
| :------------- | :------------------------------------------------------------------------------------ | :------ |
| **1. Action**  | Exact action kind (`file.read`, `process.exec`)                                       | **+20** |
|                | Action wildcard (`file.*`, `process.*`)                                               | **+10** |
|                | Universal wildcard (`*`)                                                              | **0**   |
| **2. Path**    | Exact file path or traversal boundary (`.env`, `credentials.json`, outside workspace) | **+50** |
|                | Dynamic tool rug-pull protection rule (`ask-mutated-tools`)                           | **+45** |
|                | Specific glob pattern (`**/.env*`, `docs/**`, `src/**/*.ts`)                          | **+30** |
|                | Broad wildcard (`**/*`, `*`, `**`)                                                    | **+10** |
| **3. Command** | Exact command (`npm test`, `git status`)                                              | **+50** |
|                | Sub-command pattern (`git push *`, `npm install *`, `rm -rf *`)                       | **+40** |
|                | Base command pattern (`git *`, `npm *`)                                               | **+20** |
|                | Universal command pattern (`*`)                                                       | **+10** |
| **4. Context** | Prior sensitive read sequence condition (`when.priorSensitiveRead`)                   | **+15** |
|                | Prior workspace write sequence condition (`when.priorWorkspaceWrite`)                 | **+10** |
|                | Targeted tool source origin (`when.source`)                                           | **+10** |
|                | Targeted `agentId` or `maxRiskScore` threshold                                        | **+10** |

---

## 2. Evaluation Precedence Order

When evaluating an action, rules are sorted by the following deterministic sequence:

1. **Highest Specificity Score**: The rule with the greatest numerical score takes priority (e.g. `git push *` [60] beats `git *` [40]).
2. **Safety Precedence (`DENY > ASK > ALLOW`)**: If two rules have identical specificity, the safer decision wins.
3. **Declaration Order**: If specificity and safety level are identical, the rule declared earlier in `agent-monitor.config.json` wins.
4. **Default Decision Fallback**: If no custom or built-in rules match, `policy.default` (default: `ALLOW`) is applied.

---

## 3. Built-In Default Policies

Agent Monitor ships with default secure policies out-of-the-box:

```yaml
# 1. Secret Environment Files
- id: deny-env-secrets
  action: file.*
  path: "**/.env*"
  decision: DENY
  reason: Accessing secret environment files is blocked by security policy.

# 2. SSH Keys Protection
- id: deny-ssh-keys
  action: file.*
  path: "~/.ssh/**"
  decision: DENY
  reason: Accessing private SSH keys is blocked by security policy.

# 3. Workspace Containment Boundary
- id: deny-outside-workspace
  action: file.*
  decision: DENY
  reason: File operations outside the designated workspace root are prohibited.

# 4. Destructive Deletion
- id: deny-destructive-rm
  action: process.exec
  command: "rm -rf *"
  decision: DENY
  reason: Destructive recursive removal commands are blocked by security policy.

# 5. Remote Git Push
- id: ask-git-push
  action: process.exec
  command: "git push *"
  decision: ASK
  reason: Pushing changes to a remote repository requires human approval.

# 6. Package Installation
- id: ask-npm-install
  action: process.exec
  command: "npm install *"
  decision: ASK
  reason: Installing package dependencies requires human approval.

# 7. Dynamic Tool Mutation (Rug-Pull Protection)
- id: ask-mutated-tools
  action: "*"
  decision: ASK
  reason: External tool schema or description was modified at runtime after session discovery (potential tool rug-pull). Operator approval required.

# 8. Safe Workspace Reading & Testing
- id: allow-workspace-file-read
  action: file.read
  decision: ALLOW
  reason: Reading files inside workspace is permitted.

- id: allow-npm-test
  action: process.exec
  command: "npm test"
  decision: ALLOW
  reason: Running tests is permitted.
```

---

## 4. Custom Policy Examples

You can add custom rules to `agent-monitor.config.json`:

### Protect Production Configuration

```json
{
  "id": "protect-prod-config",
  "action": "file.write",
  "path": "config/production.json",
  "decision": "ASK",
  "reason": "Modifications to production configuration require human review."
}
```

### Gate Database Migrations

```json
{
  "id": "gate-db-migrations",
  "action": "process.exec",
  "command": "npm run migrate *",
  "decision": "ASK",
  "reason": "Database migrations require operator confirmation."
}
```

### Block Shell Downloads

```json
{
  "id": "deny-curl-sh",
  "action": "process.exec",
  "command": "curl *",
  "decision": "ASK",
  "reason": "Outbound network requests require approval."
}
```

---

## 5. Simulating Policies

To verify your custom policies before launching an agent:

```bash
# Test custom rule
npm run cli -- policy check --action file.write --path "config/production.json"
```

Output:

```text
  Action:         file.write
  Path:           config/production.json
  Decision:       ⚠️  ASK (Requires human approval before execution)
  Specificity:    70
  Matched Rules:  protect-prod-config
  Reason:         Modifications to production configuration require human review.
```
