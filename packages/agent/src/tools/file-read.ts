import fs from 'node:fs';
import { FileReadParams, FileReadResult } from '@agent-monitor/core';
import { ToolDefinition } from '../runtime.js';
import { resolveSafeWorkspacePath, MAX_FILE_SIZE_BYTES } from './guardrails.js';

export const readFileTool: ToolDefinition<FileReadParams, FileReadResult> = {
  name: 'read_file',
  actionKind: 'file.read',
  category: 'file',
  description: 'Read the text contents of a file within the workspace with optional line slice.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the file to read',
      },
      startLine: {
        type: 'integer',
        description: 'Optional 1-based start line number',
      },
      endLine: {
        type: 'integer',
        description: 'Optional 1-based end line number',
      },
    },
    required: ['path'],
  },
  execute: async (params, ctx) => {
    const { safePath, isOutsideWorkspace, reason } = resolveSafeWorkspacePath(
      params.path,
      ctx.workspaceRoot
    );

    if (isOutsideWorkspace) {
      throw new Error(`Security Violation: ${reason}`);
    }

    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${params.path}`);
    }

    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      throw new Error(`Cannot read directory as file: ${params.path}`);
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB (${stat.size} bytes)`
      );
    }

    const rawContent = fs.readFileSync(safePath, 'utf8');
    const lines = rawContent.split('\n');
    const totalLines = lines.length;

    let content = rawContent;
    if (params.startLine !== undefined || params.endLine !== undefined) {
      const start = Math.max(1, params.startLine || 1);
      const end = Math.min(totalLines, params.endLine || totalLines);
      content = lines.slice(start - 1, end).join('\n');
    }

    return {
      path: params.path,
      content,
      totalLines,
      bytesRead: Buffer.byteLength(content, 'utf8'),
    };
  },
};
