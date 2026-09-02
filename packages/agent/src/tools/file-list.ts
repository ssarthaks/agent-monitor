import fs from 'node:fs';
import path from 'node:path';
import { FileListParams, FileListResult } from '@agent-monitor/core';
import { ToolDefinition } from '../runtime.js';
import { resolveSafeWorkspacePath } from './guardrails.js';

export const listFilesTool: ToolDefinition<FileListParams, FileListResult> = {
  name: 'list_files',
  actionKind: 'file.list',
  category: 'file',
  description: 'List files and directories in the workspace (ignores node_modules and .git).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative subdirectory to list (defaults to workspace root ".")'
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list subdirectories recursively (defaults to true)'
      }
    }
  },
  execute: async (params, ctx) => {
    const targetSubpath = params.path || '.';
    const { safePath, isOutsideWorkspace, reason } = resolveSafeWorkspacePath(
      targetSubpath,
      ctx.workspaceRoot
    );

    if (isOutsideWorkspace) {
      throw new Error(`Security Violation: ${reason}`);
    }

    if (!fs.existsSync(safePath)) {
      throw new Error(`Directory not found: ${targetSubpath}`);
    }

    const stat = fs.statSync(safePath);
    if (!stat.isDirectory()) {
      throw new Error(`Target is not a directory: ${targetSubpath}`);
    }

    const recursive = params.recursive !== false;
    const entries: FileListResult['entries'] = [];

    const walk = (dir: string, relBase: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === 'node_modules' || item.name === '.git' || item.name === '.next') {
          continue;
        }

        const itemRelPath = path.join(relBase, item.name);
        const itemFullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: itemRelPath,
            type: 'directory'
          });
          if (recursive) {
            walk(itemFullPath, itemRelPath);
          }
        } else if (item.isFile()) {
          let size = 0;
          try {
            size = fs.statSync(itemFullPath).size;
          } catch {
            // ignore
          }
          entries.push({
            name: item.name,
            path: itemRelPath,
            type: 'file',
            size
          });
        }
      }
    };

    walk(safePath, targetSubpath === '.' ? '' : targetSubpath);

    return {
      path: targetSubpath,
      entries,
      totalCount: entries.length
    };
  }
};
