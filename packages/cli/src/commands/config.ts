import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { PolicyEngine, PolicyConfig } from "@agent-monitor/core";

export interface ConfigInitOptions {
  workspace?: string;
  force?: boolean;
}

export interface ConfigValidateOptions {
  config?: string;
  workspace?: string;
}

const DEFAULT_CONFIG_TEMPLATE: PolicyConfig = {
  policy: {
    default: "ALLOW",
  },
  approval: {
    timeoutMs: 300000,
  },
  rules: [
    {
      id: "protect-environment-files",
      name: "Protect Environment Files",
      action: "file.*",
      path: "**/.env*",
      decision: "DENY",
      reason:
        "Prevent AI agents from reading or modifying environment secrets.",
    },
    {
      id: "protect-ssh-keys",
      name: "Protect SSH Keys",
      action: "file.*",
      path: "~/.ssh/**",
      decision: "DENY",
      reason: "Prevent AI agents from accessing private SSH keys.",
    },
    {
      id: "gate-git-push",
      name: "Gate Remote Git Push",
      action: "process.exec",
      command: "git push *",
      decision: "ASK",
      reason:
        "Pushing code to remote repositories requires explicit human approval.",
    },
    {
      id: "gate-dependency-install",
      name: "Gate Dependency Installation",
      action: "process.exec",
      command: "npm install *",
      decision: "ASK",
      reason: "Installing third-party packages requires human approval.",
    },
  ],
};

export async function runConfigInitCommand(
  options: ConfigInitOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const targetPath = path.join(workspaceRoot, "agent-monitor.config.json");

  if (fs.existsSync(targetPath) && !options.force) {
    console.log(pc.yellow(`\n⚠️  Configuration file already exists:`));
    console.log(`   ${pc.white(targetPath)}`);
    console.log(
      pc.dim(`\nUse --force to overwrite the existing configuration.\n`),
    );
    return;
  }

  const content = JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + "\n";
  fs.writeFileSync(targetPath, content, "utf8");

  console.log(pc.bold(pc.green(`\n✓ Created agent-monitor.config.json`)));
  console.log(`  Location: ${pc.cyan(targetPath)}\n`);
  console.log(pc.bold("Next steps:"));
  console.log(
    `  1. Review or customize policy rules in ${pc.white("agent-monitor.config.json")}`,
  );
  console.log(
    `  2. Test a policy rule:   ${pc.yellow('agent-monitor policy check --command "git push origin main"')}`,
  );
  console.log(
    `  3. Run an agent task:    ${pc.yellow('agent-monitor run --task "Your task description"')}\n`,
  );
}

export async function runConfigValidateCommand(
  configPathArg?: string,
  options: ConfigValidateOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const configPath = configPathArg
    ? path.resolve(configPathArg)
    : options.config
      ? path.resolve(options.config)
      : path.join(workspaceRoot, "agent-monitor.config.json");

  if (!fs.existsSync(configPath)) {
    console.error(pc.red(`\n❌ Configuration file not found: ${configPath}`));
    console.error(
      pc.dim(
        `Run 'agent-monitor config init' to create a starter configuration.\n`,
      ),
    );
    process.exit(1);
  }

  try {
    const rawContent = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(rawContent);
    const result = PolicyEngine.validateConfig(parsed);

    if (!result.valid) {
      console.error(pc.red(`\n❌ Invalid configuration in ${configPath}:`));
      for (const err of result.errors) {
        console.error(`  - ${pc.yellow(err)}`);
      }
      console.log();
      process.exit(1);
    }

    const rulesCount = Array.isArray(parsed.rules) ? parsed.rules.length : 0;
    const defaultDecision = parsed.policy?.default || "ALLOW";
    const timeoutSeconds = (
      (parsed.approval?.timeoutMs || parsed.policy?.timeoutMs || 300000) / 1000
    ).toFixed(0);

    console.log(pc.bold(pc.green(`\n✓ Configuration is valid:`)));
    console.log(`  File:             ${pc.white(configPath)}`);
    console.log(`  Default Decision: ${pc.cyan(defaultDecision)}`);
    console.log(`  Approval Timeout: ${pc.cyan(`${timeoutSeconds}s`)}`);
    console.log(`  Rules Defined:    ${pc.cyan(String(rulesCount))}\n`);
  } catch (err: any) {
    console.error(pc.red(`\n❌ Syntax Error in ${configPath}:`));
    console.error(`  ${err.message}\n`);
    process.exit(1);
  }
}
