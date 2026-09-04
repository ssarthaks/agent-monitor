import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/policy/engine.js';
import { calculateRuleSpecificity, matchPath } from '../src/policy/matcher.js';
import { PolicyRule } from '../src/policy/types.js';

describe('PolicyEngine — Deterministic Policy Engine (Phase A & Fixes)', () => {
  it('calculates deterministic, additive rule specificity', () => {
    const specificEnvRule: PolicyRule = {
      id: 'specific-env',
      action: 'file.read', // 20
      path: '.env', // 50
      decision: 'DENY',
    };
    // 20 + 50 = 70
    expect(calculateRuleSpecificity(specificEnvRule)).toBe(70);

    const broadEnvRule: PolicyRule = {
      id: 'broad-env',
      action: 'file.*', // 10
      path: '**/.env*', // 30
      decision: 'DENY',
    };
    // 10 + 30 = 40
    expect(calculateRuleSpecificity(broadEnvRule)).toBe(40);

    const specificGitPush: PolicyRule = {
      id: 'git-push',
      action: 'process.exec', // 20
      command: 'git push *', // 40
      decision: 'ASK',
    };
    // 20 + 40 = 60
    expect(calculateRuleSpecificity(specificGitPush)).toBe(60);

    const genericGit: PolicyRule = {
      id: 'git-all',
      action: 'process.exec', // 20
      command: 'git *', // 20
      decision: 'ALLOW',
    };
    // 20 + 20 = 40
    expect(calculateRuleSpecificity(genericGit)).toBe(40);

    expect(calculateRuleSpecificity(specificGitPush)).toBeGreaterThan(
      calculateRuleSpecificity(genericGit)
    );
  });

  it('evaluates more specific rule over broader rule (git push * > git *)', () => {
    const engine = new PolicyEngine({
      rules: [
        {
          id: 'allow-git-broad',
          action: 'process.exec',
          command: 'git *',
          decision: 'ALLOW',
        },
        {
          id: 'ask-git-push-specific',
          action: 'process.exec',
          command: 'git push *',
          decision: 'ASK',
        },
      ],
    });

    const context = { workspaceRoot: '/app' };

    // 1. git push origin main -> should match ask-git-push-specific (higher specificity)
    const resPush = engine.evaluate(
      { kind: 'process.exec', params: { command: 'git push origin main' } },
      context
    );
    expect(resPush.decision).toBe('ASK');
    expect(resPush.matchedPolicies[0]).toBe('ask-git-push-specific');

    // 2. git status -> should match allow-git-broad
    const resStatus = engine.evaluate(
      { kind: 'process.exec', params: { command: 'git status' } },
      context
    );
    expect(resStatus.decision).toBe('ALLOW');
  });

  it('enforces safety precedence (DENY > ASK > ALLOW) when specificity is equal', () => {
    const engine = new PolicyEngine({
      rules: [
        {
          id: 'allow-cmd',
          action: 'process.exec',
          command: 'curl *',
          decision: 'ALLOW',
        },
        {
          id: 'deny-cmd',
          action: 'process.exec',
          command: 'curl *',
          decision: 'DENY',
        },
      ],
    });

    const res = engine.evaluate(
      { kind: 'process.exec', params: { command: 'curl https://example.com' } },
      { workspaceRoot: '/app' }
    );
    expect(res.decision).toBe('DENY');
    expect(res.matchedPolicies[0]).toBe('deny-cmd');
  });

  it('accurately matches **/ globs for BOTH root-level and nested files (Fix 1)', () => {
    const workspaceRoot = '/app';

    // 1. **/*.secret matches root key.secret and nested subdir/key.secret
    expect(matchPath('**/*.secret', 'key.secret', workspaceRoot)).toBe(true);
    expect(matchPath('**/*.secret', 'subdir/key.secret', workspaceRoot)).toBe(true);
    expect(matchPath('**/*.secret', 'a/b/c/nested.secret', workspaceRoot)).toBe(true);
    expect(matchPath('**/*.secret', 'other.txt', workspaceRoot)).toBe(false);
    expect(matchPath('**/*.secret', 'key.secret.bak', workspaceRoot)).toBe(false);

    // 2. **/secrets.json matches root secrets.json and nested config/secrets.json
    expect(matchPath('**/secrets.json', 'secrets.json', workspaceRoot)).toBe(true);
    expect(matchPath('**/secrets.json', 'config/secrets.json', workspaceRoot)).toBe(true);
    expect(matchPath('**/secrets.json', 'a/b/secrets.json', workspaceRoot)).toBe(true);
    expect(matchPath('**/secrets.json', 'config/other.json', workspaceRoot)).toBe(false);

    // 3. Evaluation through PolicyEngine
    const engine = new PolicyEngine({
      rules: [
        { id: 'deny-secret-ext', action: 'file.read', path: '**/*.secret', decision: 'DENY' },
        { id: 'deny-secrets-json', action: 'file.read', path: '**/secrets.json', decision: 'DENY' },
      ],
    });

    // Root-level match
    const resRootSecret = engine.evaluate({ kind: 'file.read', params: { path: 'key.secret' } }, { workspaceRoot });
    expect(resRootSecret.decision).toBe('DENY');
    expect(resRootSecret.matchedPolicies).toContain('deny-secret-ext');

    const resRootJson = engine.evaluate({ kind: 'file.read', params: { path: 'secrets.json' } }, { workspaceRoot });
    expect(resRootJson.decision).toBe('DENY');
    expect(resRootJson.matchedPolicies).toContain('deny-secrets-json');

    // Nested match
    const resNestedSecret = engine.evaluate({ kind: 'file.read', params: { path: 'subdir/key.secret' } }, { workspaceRoot });
    expect(resNestedSecret.decision).toBe('DENY');

    const resNestedJson = engine.evaluate({ kind: 'file.read', params: { path: 'config/secrets.json' } }, { workspaceRoot });
    expect(resNestedJson.decision).toBe('DENY');

    // Negative match -> falls back to default ALLOW
    const resSafe = engine.evaluate({ kind: 'file.read', params: { path: 'src/main.ts' } }, { workspaceRoot });
    expect(resSafe.decision).toBe('ALLOW');
  });

  it('applies default built-in secure policies out-of-the-box', () => {
    const engine = new PolicyEngine(); // No config -> built-in defaults

    const ctx = { workspaceRoot: '/app' };

    // A. DENY: Secret environment files
    const resEnv = engine.evaluate({ kind: 'file.read', params: { path: '.env' } }, ctx);
    expect(resEnv.decision).toBe('DENY');

    // B. DENY: SSH private keys
    const resSsh = engine.evaluate({ kind: 'file.read', params: { path: '~/.ssh/id_rsa' } }, ctx);
    expect(resSsh.decision).toBe('DENY');

    // C. DENY: Path traversal outside workspace
    const resOutside = engine.evaluate(
      { kind: 'file.read', params: { path: '/etc/passwd' } },
      { workspaceRoot: '/app', isOutsideWorkspace: true }
    );
    expect(resOutside.decision).toBe('DENY');

    // D. ASK: git push
    const resPush = engine.evaluate(
      { kind: 'process.exec', params: { command: 'git push origin main' } },
      ctx
    );
    expect(resPush.decision).toBe('ASK');

    // E. ASK: npm install
    const resInstall = engine.evaluate(
      { kind: 'process.exec', params: { command: 'npm install express' } },
      ctx
    );
    expect(resInstall.decision).toBe('ASK');

    // F. ALLOW: npm test
    const resTest = engine.evaluate(
      { kind: 'process.exec', params: { command: 'npm test' } },
      ctx
    );
    expect(resTest.decision).toBe('ALLOW');

    // G. ALLOW: normal workspace file read/write
    const resRead = engine.evaluate(
      { kind: 'file.read', params: { path: 'src/App.tsx' } },
      ctx
    );
    expect(resRead.decision).toBe('ALLOW');

    const resWrite = engine.evaluate(
      { kind: 'file.write', params: { path: 'src/App.tsx' } },
      ctx
    );
    expect(resWrite.decision).toBe('ALLOW');
  });

  it('validates custom configuration properly', () => {
    // Valid config
    const valid = PolicyEngine.validateConfig({
      policy: { default: 'ASK' },
      approval: { timeoutMs: 60000 },
      rules: [
        { id: 'custom-1', action: 'file.read', path: 'docs/**', decision: 'ALLOW' },
      ],
    });
    expect(valid.valid).toBe(true);
    expect(valid.errors.length).toBe(0);

    // Invalid config (bad decision, missing ID)
    const invalid = PolicyEngine.validateConfig({
      policy: { default: 'UNKNOWN' },
      approval: { timeoutMs: -50 },
      rules: [
        { action: 'file.read', decision: 'INVALID_DECISION' },
      ],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('ADVERSARIAL (VULN-05): blocks rm flag permutations and shell execution wrappers from bypassing policy', () => {
    const engine = new PolicyEngine(); // uses DEFAULT_POLICY_RULES
    const ctx = { workspaceRoot: '/app' };

    // 1. rm -fr / (flag permutation)
    const res1 = engine.evaluate(
      { kind: 'process.exec', params: { command: 'rm -fr /' } },
      ctx
    );
    expect(res1.decision).toBe('DENY');
    expect(res1.matchedPolicies).toContain('deny-destructive-rm-root');

    // 2. rm -r -f /
    const res2 = engine.evaluate(
      { kind: 'process.exec', params: { command: 'rm -r -f /' } },
      ctx
    );
    expect(res2.decision).toBe('DENY');

    // 3. sudo rm -rf / (privilege wrapper)
    const res3 = engine.evaluate(
      { kind: 'process.exec', params: { command: 'sudo rm -rf /' } },
      ctx
    );
    expect(res3.decision).toBe('DENY');

    // 4. sh -c "rm -rf /" (shell execution wrapper)
    const res4 = engine.evaluate(
      { kind: 'process.exec', params: { command: 'sh -c "rm -rf /"' } },
      ctx
    );
    expect(res4.decision).toBe('DENY');

    // 5. sudo git push origin main (wrapper on ASK rule)
    const res5 = engine.evaluate(
      { kind: 'process.exec', params: { command: 'sudo git push origin main' } },
      ctx
    );
    expect(res5.decision).toBe('ASK');
    expect(res5.matchedPolicies).toContain('ask-git-push');
  });

  it('ADVERSARIAL (VULN-03): authoritative containment blocks custom or unmapped file tools outside workspace', () => {
    const engine = new PolicyEngine(); // uses DEFAULT_POLICY_RULES

    // 1. Custom tool categorized as file with outside workspace path
    const resCustom = engine.evaluate(
      { kind: 'file.custom.view_file', category: 'file', params: { path: '/etc/passwd' } },
      { workspaceRoot: '/app', isOutsideWorkspace: true }
    );
    expect(resCustom.decision).toBe('DENY');
    expect(resCustom.matchedPolicies).toContain('deny-outside-workspace');

    // 2. Completely unmapped custom tool with outside workspace path
    const resUnmapped = engine.evaluate(
      { kind: 'custom.mcp.some_reader', category: 'custom', params: { path: '../../shadow' } },
      { workspaceRoot: '/app', isOutsideWorkspace: true }
    );
    expect(resUnmapped.decision).toBe('DENY');
    expect(resUnmapped.matchedPolicies).toContain('deny-outside-workspace');
  });
});
