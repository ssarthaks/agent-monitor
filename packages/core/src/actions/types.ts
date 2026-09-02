export type ActionCategory = 'file' | 'process' | 'network' | 'system' | 'custom';

export type ActionKind =
  | 'file.read'
  | 'file.write'
  | 'file.list'
  | 'file.delete'
  | 'process.exec'
  | 'network.request'
  | string;

export interface FileReadParams {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface FileReadResult {
  path: string;
  content: string;
  totalLines: number;
  bytesRead: number;
}

export interface FileWriteParams {
  path: string;
  content: string;
  overwrite?: boolean;
}

export interface FileWriteResult {
  path: string;
  bytesWritten: number;
  linesChanged: number;
  isNewFile: boolean;
  diff?: string;
}

export interface FileListParams {
  path?: string;
  recursive?: boolean;
}

export interface FileListResult {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
  }>;
  totalCount: number;
}

export interface ProcessExecParams {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface ProcessExecResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}
