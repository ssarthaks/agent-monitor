import { RiskRule } from './types.js';

export const DETERMINISTIC_RISK_RULES: RiskRule[] = [
  // 1. Secrets & Environment files
  {
    id: 'SEC_DOTENV',
    description: 'Accessing environment configuration or secret variables (.env)',
    severity: 'HIGH',
    scoreImpact: 40,
    matches: (kind, params) => {
      if (!kind.startsWith('file.')) return false;
      const pathStr = String(params.path || '').toLowerCase();
      return /(^|[/\\])\.env(\.[a-z0-9_-]+)?$/i.test(pathStr) || pathStr.includes('.env');
    },
  },
  // 2. SSH Keys & Credentials
  {
    id: 'SEC_SSH_KEYS',
    description: 'Accessing SSH private keys or known_hosts',
    severity: 'HIGH',
    scoreImpact: 50,
    matches: (kind, params) => {
      if (!kind.startsWith('file.')) return false;
      const pathStr = String(params.path || '').toLowerCase();
      return /(\.ssh|id_rsa|id_ed25519|id_ecdsa|id_dsa)/i.test(pathStr);
    },
  },
  {
    id: 'SEC_CREDENTIALS',
    description: 'Accessing credentials, secrets, or cloud configuration files',
    severity: 'HIGH',
    scoreImpact: 40,
    matches: (kind, params) => {
      if (!kind.startsWith('file.')) return false;
      const pathStr = String(params.path || '').toLowerCase();
      return /(credentials\.json|\.aws|\.npmrc|\.netrc|id_token|private_key\.pem)/i.test(pathStr);
    },
  },
  // 3. Destructive deletion command
  {
    id: 'CMD_DESTRUCTIVE_RM',
    description: 'Executing destructive deletion command (rm -rf / recursive forced remove)',
    severity: 'CRITICAL',
    scoreImpact: 60,
    matches: (kind, params) => {
      if (kind !== 'process.exec') return false;
      const cmd = String(params.command || '');
      return /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/i.test(cmd) || /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/i.test(cmd);
    },
  },
  // 4. Privilege escalation
  {
    id: 'CMD_PRIVILEGE_ESCALATION',
    description: 'Attempting privilege escalation (sudo / su / doas)',
    severity: 'HIGH',
    scoreImpact: 45,
    matches: (kind, params) => {
      if (kind !== 'process.exec') return false;
      const cmd = String(params.command || '');
      return /\b(sudo|su|doas)\b/i.test(cmd);
    },
  },
  // 5. Outbound network tools
  {
    id: 'CMD_NETWORK_OUTBOUND',
    description: 'Executing outbound network command or data transfer tool',
    severity: 'MEDIUM',
    scoreImpact: 25,
    matches: (kind, params) => {
      if (kind !== 'process.exec') return false;
      const cmd = String(params.command || '');
      return /\b(curl|wget|nc|ncat|netcat|ssh|scp|rsync|ftp|telnet)\b/i.test(cmd);
    },
  },
  // 6. Path Traversal outside workspace
  {
    id: 'PATH_TRAVERSAL',
    description: 'Target path resolves outside the designated workspace root',
    severity: 'HIGH',
    scoreImpact: 45,
    matches: (_kind, _params, context) => {
      return Boolean(context?.isOutsideWorkspace);
    },
  },
  // 7. Git repository internal corruption
  {
    id: 'GIT_INTERNAL_ACCESS',
    description: 'Accessing internal Git object storage or hooks (.git directory)',
    severity: 'MEDIUM',
    scoreImpact: 20,
    matches: (kind, params) => {
      if (!kind.startsWith('file.')) return false;
      const pathStr = String(params.path || '');
      return /(^|[/\\])\.git([/\\]|$)/i.test(pathStr);
    },
  },
];
