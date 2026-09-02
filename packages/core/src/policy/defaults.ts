import { PolicyRule } from "./types.js";

/**
 * Default secure policies for Agent Monitor V0.2.
 * Provides out-of-the-box protection without requiring a configuration file.
 */
export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  // ─────────────────────────────────────────────────────────────
  // 1. CRITICAL DENY RULES (Secrets, System Integrity, Dangerous Ops)
  // ─────────────────────────────────────────────────────────────
  {
    id: "deny-outside-workspace",
    name: "Deny path traversal outside workspace",
    action: "file.*",
    decision: "DENY",
    reason:
      "Path traversal outside the designated workspace root is strictly blocked.",
  },
  {
    id: "deny-env-secrets",
    name: "Protect environment configuration files",
    action: "file.*",
    path: "**/.env*",
    decision: "DENY",
    reason:
      "Accessing secret environment files (.env) is blocked by security policy.",
  },
  {
    id: "deny-ssh-directory",
    name: "Protect SSH private keys and known hosts",
    action: "file.*",
    path: "~/.ssh/**",
    decision: "DENY",
    reason:
      "Accessing SSH directory or private keys is blocked by security policy.",
  },
  {
    id: "deny-credentials-file",
    name: "Protect credential files and tokens",
    action: "file.*",
    path: "credentials.json",
    decision: "DENY",
    reason:
      "Accessing cloud credentials or secret tokens is blocked by security policy.",
  },
  {
    id: "deny-destructive-rm",
    name: "Block destructive recursive forced deletion",
    action: "process.exec",
    command: "rm -rf *",
    decision: "DENY",
    reason:
      "Executing destructive recursive deletion (rm -rf) is blocked by safety policy.",
  },
  {
    id: "deny-destructive-rm-root",
    name: "Block deletion of system or workspace root",
    action: "process.exec",
    command: "rm -rf /",
    decision: "DENY",
    reason: "Executing root system deletion is strictly blocked.",
  },

  // ─────────────────────────────────────────────────────────────
  // 2. ASK / HUMAN APPROVAL RULES (Remote Mutation, Dependencies, Escalation)
  // ─────────────────────────────────────────────────────────────
  {
    id: "ask-git-push",
    name: "Require approval for Git push to remote",
    action: "process.exec",
    command: "git push *",
    decision: "ASK",
    reason: "Pushing changes to a remote repository requires human approval.",
  },
  {
    id: "ask-npm-install",
    name: "Require approval for npm package installation",
    action: "process.exec",
    command: "npm install *",
    decision: "ASK",
    reason: "Installing package dependencies requires human approval.",
  },
  {
    id: "ask-pnpm-add",
    name: "Require approval for pnpm package addition",
    action: "process.exec",
    command: "pnpm add *",
    decision: "ASK",
    reason: "Installing package dependencies requires human approval.",
  },
  {
    id: "ask-yarn-add",
    name: "Require approval for yarn package addition",
    action: "process.exec",
    command: "yarn add *",
    decision: "ASK",
    reason: "Installing package dependencies requires human approval.",
  },
  {
    id: "ask-outbound-curl",
    name: "Require approval for outbound curl network calls",
    action: "process.exec",
    command: "curl *",
    decision: "ASK",
    reason:
      "Executing outbound network transfers (curl) requires human approval.",
  },
  {
    id: "ask-outbound-wget",
    name: "Require approval for outbound wget network calls",
    action: "process.exec",
    command: "wget *",
    decision: "ASK",
    reason:
      "Executing outbound network downloads (wget) requires human approval.",
  },
  {
    id: "ask-privilege-escalation",
    name: "Require approval for sudo privilege escalation",
    action: "process.exec",
    command: "sudo *",
    decision: "ASK",
    reason: "Attempting privilege escalation (sudo) requires human approval.",
  },

  // ─────────────────────────────────────────────────────────────
  // 3. ALLOW RULES (Safe In-Workspace Development Operations)
  // ─────────────────────────────────────────────────────────────
  {
    id: "allow-npm-test",
    name: "Allow running test suite",
    action: "process.exec",
    command: "npm test",
    decision: "ALLOW",
    reason: "Running project tests is permitted.",
  },
  {
    id: "allow-npm-run",
    name: "Allow standard npm run scripts",
    action: "process.exec",
    command: "npm run *",
    decision: "ALLOW",
    reason: "Running configured npm scripts is permitted.",
  },
  {
    id: "allow-git-status",
    name: "Allow Git status inspection",
    action: "process.exec",
    command: "git status",
    decision: "ALLOW",
    reason: "Inspecting Git repository status is permitted.",
  },
  {
    id: "allow-git-diff",
    name: "Allow Git diff inspection",
    action: "process.exec",
    command: "git diff",
    decision: "ALLOW",
    reason: "Inspecting file diffs is permitted.",
  },
  {
    id: "allow-git-log",
    name: "Allow Git commit log inspection",
    action: "process.exec",
    command: "git log*",
    decision: "ALLOW",
    reason: "Inspecting Git commit history is permitted.",
  },
  {
    id: "allow-workspace-file-read",
    name: "Allow reading files inside workspace",
    action: "file.read",
    decision: "ALLOW",
    reason: "Reading files inside workspace is permitted.",
  },
  {
    id: "allow-workspace-file-write",
    name: "Allow writing files inside workspace",
    action: "file.write",
    decision: "ALLOW",
    reason: "Modifying files inside workspace is permitted.",
  },
  {
    id: "allow-workspace-file-list",
    name: "Allow listing directory files inside workspace",
    action: "file.list",
    decision: "ALLOW",
    reason: "Listing directory contents is permitted.",
  },
];
