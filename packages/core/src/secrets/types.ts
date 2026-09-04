export interface SecretPattern {
  type: string;
  regex: RegExp;
}

export interface RedactionResult<T = any> {
  value: T;
  hasSecrets: boolean;
  types: string[];
}
