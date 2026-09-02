# Configuration Guide (`agent-monitor.config.json`)

Agent Monitor is configured via an optional `agent-monitor.config.json` file in your workspace root, or specified via the `--config <path>` CLI option.

---

## 1. Quick Bootstrap

Generate a valid starter configuration file:

```bash
agent-monitor config init
```

Validate an existing configuration:

```bash
agent-monitor config validate
```

---

## 2. Configuration Schema

```json
{
  "$schema": "https://raw.githubusercontent.com/agentsentry/agent-monitor/main/schema.json",
  "policy": {
    "default": "ALLOW",
    "timeoutMs": 300000
  },
  "approval": {
    "timeoutMs": 300000
  },
  "rules": [
    {
      "id": "protect-environment-files",
      "name": "Protect Environment Files",
      "action": "file.*",
      "path": "**/.env*",
      "decision": "DENY",
      "reason": "Prevent AI agents from reading or modifying environment secrets."
    },
    {
      "id": "gate-git-push",
      "name": "Gate Remote Git Push",
      "action": "process.exec",
      "command": "git push *",
      "decision": "ASK",
      "reason": "Pushing code to remote repositories requires explicit human approval."
    }
  ]
}
```

---

## 3. Property Reference

### Top-Level Properties

| Property             | Type           | Default   | Description                                                                              |
| :------------------- | :------------- | :-------- | :--------------------------------------------------------------------------------------- |
| `policy.default`     | `string`       | `"ALLOW"` | Default policy decision (`"ALLOW"`, `"DENY"`, or `"ASK"`) when no specific rule matches. |
| `policy.timeoutMs`   | `number`       | `300000`  | Human approval timeout in milliseconds (5 minutes). Alias for `approval.timeoutMs`.      |
| `approval.timeoutMs` | `number`       | `300000`  | Human approval timeout in milliseconds.                                                  |
| `rules`              | `PolicyRule[]` | `[]`      | Array of custom policy rules evaluated before built-in defaults.                         |

---

### `PolicyRule` Properties

| Property       | Type     | Required | Description                                                                 | Example                                    |
| :------------- | :------- | :------- | :-------------------------------------------------------------------------- | :----------------------------------------- |
| `id`           | `string` | **Yes**  | Unique identifier for the policy rule.                                      | `"deny-keys"`                              |
| `name`         | `string` | No       | Human-readable name displayed in logs and DevTools.                         | `"Protect Secret Keys"`                    |
| `decision`     | `string` | **Yes**  | Policy decision: `"ALLOW"`, `"DENY"`, or `"ASK"`.                           | `"DENY"`                                   |
| `action`       | `string` | No\*     | Target action pattern (`"file.read"`, `"file.*"`, `"process.exec"`, `"*"`). | `"file.write"`                             |
| `path`         | `string` | No\*     | Glob pattern for file actions (supports `**`, `*`, `?`, `~`).               | `"**/*.secret"`                            |
| `command`      | `string` | No\*     | Command pattern for `process.exec` (supports prefixes and wildcards).       | `"npm publish *"`                          |
| `reason`       | `string` | No       | Explanation shown to the user in approval prompts and blocked events.       | `"Publishing packages requires sign-off."` |
| `agentId`      | `string` | No       | Restrict rule matching to a specific agent identifier.                      | `"deepseek-coding-agent"`                  |
| `maxRiskScore` | `number` | No       | Maximum allowed risk score (0–100) before rule match is rejected.           | `50`                                       |

_\*Note: At least one of `action`, `path`, or `command` must be specified._

---

## 4. Configuration Precedence

Settings are resolved in the following priority order (highest to lowest):

1. **CLI Flags**: Arguments passed directly to the command (e.g. `--port 5050`, `--config ./custom.json`).
2. **Environment Variables**: System variables (e.g. `AGENT_MONITOR_PORT`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`).
3. **Workspace Configuration**: Properties in `agent-monitor.config.json`.
4. **Built-in Defaults**: Default port `4040`, timeout `300000ms`, default decision `ALLOW`.

---

## 5. Supported Environment Variables

| Variable             | Default         | Purpose                                                          |
| :------------------- | :-------------- | :--------------------------------------------------------------- |
| `DEEPSEEK_API_KEY`   | _(None)_        | Required for running the reference DeepSeek coding agent.        |
| `DEEPSEEK_MODEL`     | `deepseek-chat` | Model used for agent reasoning.                                  |
| `AGENT_MONITOR_PORT` | `4040`          | Default port for Monitor Server REST API and DevTools dashboard. |
| `PORT`               | `3000`          | Fallback dashboard port.                                         |
