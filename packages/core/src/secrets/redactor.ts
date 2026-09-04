import { SecretPattern, RedactionResult } from "./types.js";

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: "PRIVATE_KEY",
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gi,
  },
  {
    type: "PRIVATE_KEY",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gi,
  },
  {
    type: "OPENAI_API_KEY",
    regex: /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
  },
  {
    type: "ANTHROPIC_API_KEY",
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
  },
  {
    type: "DEEPSEEK_API_KEY",
    regex: /\bsk-[a-f0-9]{32}\b/g,
  },
  {
    type: "GITHUB_TOKEN",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,}\b/g,
  },
  {
    type: "GITLAB_TOKEN",
    regex: /\bglpat-[a-zA-Z0-9_-]{20,}\b/g,
  },
  {
    type: "AWS_ACCESS_KEY",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    type: "AWS_SECRET_KEY",
    regex:
      /(?:aws_secret_access_key|aws_secret|secret_key)\s*[:=]\s*["']?([a-zA-Z0-9/+=]{40})["']?/gi,
  },
  {
    type: "JWT_TOKEN",
    regex:
      /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
  },
  {
    type: "STRIPE_API_KEY",
    regex: /\b(?:sk|rk)_(?:test|live)_[0-9a-zA-Z]{24,}\b/g,
  },
  {
    type: "SLACK_TOKEN",
    regex: /\bxox[baprs]-[0-9a-zA-Z-]{20,}\b/g,
  },
  {
    type: "DB_CONNECTION_STRING",
    regex: /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'<>]+/gi,
  },
  {
    type: "AUTHORIZATION_HEADER",
    regex:
      /\b(?:Bearer\s+[a-zA-Z0-9_.~+/-]{20,}|Basic\s+[a-zA-Z0-9+/=]{20,})\b/gi,
  },
];

export function redactSecretsString(text: string): {
  text: string;
  hasSecrets: boolean;
  types: string[];
} {
  if (!text || typeof text !== "string") {
    return { text, hasSecrets: false, types: [] };
  }

  let result = text;
  let hasSecrets = false;
  const detectedTypes = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(result)) {
      hasSecrets = true;
      detectedTypes.add(pattern.type);
      pattern.regex.lastIndex = 0;
      result = result.replace(pattern.regex, `[REDACTED:${pattern.type}]`);
    }
  }

  return {
    text: result,
    hasSecrets,
    types: Array.from(detectedTypes),
  };
}

export function redactSecretsDeep<T = any>(val: T): RedactionResult<T> {
  if (val === null || val === undefined) {
    return { value: val, hasSecrets: false, types: [] };
  }

  if (typeof val === "string") {
    const res = redactSecretsString(val);
    return {
      value: res.text as unknown as T,
      hasSecrets: res.hasSecrets,
      types: res.types,
    };
  }

  if (Array.isArray(val)) {
    let anySecrets = false;
    const typesSet = new Set<string>();
    const newArr = val.map((item) => {
      const res = redactSecretsDeep(item);
      if (res.hasSecrets) {
        anySecrets = true;
        res.types.forEach((t) => typesSet.add(t));
      }
      return res.value;
    });
    return {
      value: (anySecrets ? newArr : val) as unknown as T,
      hasSecrets: anySecrets,
      types: Array.from(typesSet),
    };
  }

  if (typeof val === "object") {
    let anySecrets = false;
    const typesSet = new Set<string>();
    const newObj: Record<string, any> = {};
    let modified = false;

    for (const [k, v] of Object.entries(val)) {
      const res = redactSecretsDeep(v);
      newObj[k] = res.value;
      if (res.hasSecrets) {
        anySecrets = true;
        modified = true;
        res.types.forEach((t) => typesSet.add(t));
      }
    }

    return {
      value: (modified ? newObj : val) as unknown as T,
      hasSecrets: anySecrets,
      types: Array.from(typesSet),
    };
  }

  return { value: val, hasSecrets: false, types: [] };
}
