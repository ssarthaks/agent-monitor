import { ActionCategory, ActionKind, ActionSource } from "../actions/types.js";

export interface CanonicalAction {
  kind: ActionKind;
  category: ActionCategory;
  params: Record<string, any>;
  source: ActionSource;
  rawToolName: string;
  rawParams: Record<string, any>;
}

export interface NormalizerRule {
  matchTool: (toolName: string) => boolean;
  normalize: (
    toolName: string,
    rawParams: Record<string, any>,
    source: ActionSource,
  ) => CanonicalAction;
}
