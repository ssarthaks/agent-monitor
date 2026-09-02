# Example: Practical Policy Rule Definitions

Patterns and configurations for tailoring Agent Monitor policies to different project requirements.

---

## 1. Gating Package Modifications

Require human approval whenever dependencies or lockfiles are modified:

```json
{
  "rules": [
    {
      "id": "gate-package-json",
      "action": "file.write",
      "path": "package.json",
      "decision": "ASK",
      "reason": "Changes to package.json dependencies require human approval."
    },
    {
      "id": "gate-lockfile",
      "action": "file.write",
      "path": "package-lock.json",
      "decision": "ASK",
      "reason": "Lockfile modifications require verification."
    }
  ]
}
```

---

## 2. Gating Infrastructure & Docker Files

Protect deployment scripts, Terraform, and Docker configurations:

```json
{
  "rules": [
    {
      "id": "gate-dockerfile",
      "action": "file.write",
      "path": "**/Dockerfile*",
      "decision": "ASK",
      "reason": "Modifying container configurations requires operator review."
    },
    {
      "id": "gate-k8s-manifests",
      "action": "file.write",
      "path": "k8s/**",
      "decision": "ASK",
      "reason": "Modifying Kubernetes manifests requires sign-off."
    }
  ]
}
```

---

## 3. Blocking Credential Files

Block all variations of credential and private key files:

```json
{
  "rules": [
    {
      "id": "deny-pem-keys",
      "action": "file.*",
      "path": "**/*.pem",
      "decision": "DENY",
      "reason": "Access to PEM private keys is strictly prohibited."
    },
    {
      "id": "deny-aws-creds",
      "action": "file.*",
      "path": "~/.aws/**",
      "decision": "DENY",
      "reason": "Access to AWS credentials is prohibited."
    }
  ]
}
```

---

## 4. Gating Network Downloads

Gate any execution of `curl` or `wget`:

```json
{
  "rules": [
    {
      "id": "gate-curl",
      "action": "process.exec",
      "command": "curl *",
      "decision": "ASK",
      "reason": "Outbound HTTP downloads require approval."
    },
    {
      "id": "gate-wget",
      "action": "process.exec",
      "command": "wget *",
      "decision": "ASK",
      "reason": "Outbound HTTP downloads require approval."
    }
  ]
}
```
