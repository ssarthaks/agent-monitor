import fs from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { FileWriteParams, FileWriteResult } from '@agent-monitor/core';
import { ToolDefinition } from '../runtime.js';
import { resolveSafeWorkspacePath, MAX_FILE_SIZE_BYTES } from './guardrails.js';

export const writeFileTool: ToolDefinition<FileWriteParams, FileWriteResult> = {
  name: 'write_file',
  actionKind: 'file.write',
  category: 'file',
  description: 'Write or overwrite text content to a file within the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the file to write',
      },
      content: {
        type: 'string',
        description: 'Text content to write',
      },
      overwrite: {
        type: 'boolean',
        description: 'Whether to overwrite if file exists (defaults to true)',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (params, ctx) => {
    const { safePath, isOutsideWorkspace, reason } = resolveSafeWorkspacePath(
      params.path,
      ctx.workspaceRoot
    );

    if (isOutsideWorkspace) {
      throw new Error(`Security Violation: ${reason}`);
    }

    const byteLength = Buffer.byteLength(params.content, 'utf8');
    if (byteLength > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `Content exceeds maximum size limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB (${byteLength} bytes)`
      );
    }

    const fileExists = fs.existsSync(safePath);
    let oldContent = '';
    if (fileExists) {
      if (params.overwrite === false) {
        throw new Error(`File already exists and overwrite is set to false: ${params.path}`);
      }
      try {
        oldContent = fs.readFileSync(safePath, 'utf8');
      } catch {
        oldContent = '';
      }
    }

    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const diff = createTwoFilesPatch(
      params.path,
      params.path,
      oldContent,
      params.content,
      fileExists ? 'previous' : 'empty',
      'updated'
    );

    const oldLines = oldContent ? oldContent.split('\n').length : 0;
    const newLines = params.content.split('\n').length;
    const linesChanged = Math.abs(newLines - oldLines);

    fs.writeFileSync(safePath, params.content, 'utf8');

    return {
      path: params.path,
      bytesWritten: byteLength,
      linesChanged,
      isNewFile: !fileExists,
      diff,
    };
  },
};
