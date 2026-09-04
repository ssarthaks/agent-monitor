import { ActionCategory, ActionKind, ActionSource } from "../actions/types.js";
import { CanonicalAction } from "./types.js";

function extractPath(params: Record<string, any>): string {
  if (typeof params.path === "string") return params.path;
  if (typeof params.file_path === "string") return params.file_path;
  if (typeof params.filePath === "string") return params.filePath;
  if (typeof params.filename === "string") return params.filename;
  if (typeof params.file_name === "string") return params.file_name;
  if (typeof params.fileName === "string") return params.fileName;
  if (typeof params.file === "string") return params.file;
  if (typeof params.target === "string") return params.target;
  if (typeof params.destination === "string") return params.destination;
  if (typeof params.location === "string") return params.location;
  if (typeof params.uri === "string") {
    // Strip file:// prefix if present
    return params.uri.replace(/^file:\/\//, "");
  }
  return "";
}

function extractContent(params: Record<string, any>): string {
  if (typeof params.content === "string") return params.content;
  if (typeof params.text === "string") return params.text;
  if (typeof params.file_text === "string") return params.file_text;
  if (typeof params.data === "string") return params.data;
  if (typeof params.body === "string") return params.body;
  return "";
}

function extractCommand(params: Record<string, any>): string {
  const base =
    params.command ||
    params.cmd ||
    params.script ||
    params.exec ||
    params.binary ||
    "";
  if (Array.isArray(params.args)) {
    return `${base} ${params.args.join(" ")}`.trim();
  }
  if (typeof base === "string") return base;
  return "";
}

function extractUrl(params: Record<string, any>): string {
  if (typeof params.url === "string") return params.url;
  if (typeof params.uri === "string") return params.uri;
  if (typeof params.endpoint === "string") return params.endpoint;
  return "";
}

export class ActionNormalizer {
  /**
   * Normalizes an external tool call into a canonical domain action.
   */
  static normalize(
    toolName: string,
    rawParams: Record<string, any> = {},
    source: ActionSource,
  ): CanonicalAction {
    const nameLower = toolName.toLowerCase().replace(/[-_.]/g, "");

    // 1. File Read mappings
    if (
      nameLower === "readfile" ||
      nameLower === "read" ||
      nameLower === "fileread" ||
      nameLower === "fsread" ||
      nameLower === "getfile" ||
      nameLower === "readtextfile" ||
      nameLower === "readbinaryfile" ||
      nameLower === "viewfile" ||
      nameLower === "view" ||
      nameLower === "cat" ||
      nameLower === "openfile" ||
      nameLower === "open" ||
      nameLower === "showfile" ||
      nameLower === "show" ||
      nameLower === "loadfile" ||
      nameLower === "load" ||
      nameLower === "fetchfile" ||
      nameLower === "readtext" ||
      nameLower === "readcontent" ||
      nameLower === "getcontent" ||
      nameLower === "getfilecontent" ||
      (nameLower.includes("read") &&
        (nameLower.includes("file") || nameLower.includes("fs"))) ||
      toolName.endsWith("read_file") ||
      toolName.endsWith(".read_file") ||
      toolName.endsWith("view_file") ||
      toolName.endsWith(".view_file")
    ) {
      const path = extractPath(rawParams);
      return {
        kind: "file.read",
        category: "file",
        params: {
          ...rawParams,
          path,
          startLine:
            rawParams.startLine ?? rawParams.start_line ?? rawParams.offset,
          endLine: rawParams.endLine ?? rawParams.end_line ?? rawParams.limit,
        },
        source: { ...source, toolName },
        rawToolName: toolName,
        rawParams,
      };
    }

    // 2. File Write mappings
    if (
      nameLower === "writefile" ||
      nameLower === "write" ||
      nameLower === "filewrite" ||
      nameLower === "fswrite" ||
      nameLower === "createfile" ||
      nameLower === "appendfile" ||
      nameLower === "editfile" ||
      nameLower === "putfile" ||
      nameLower === "put" ||
      nameLower === "savefile" ||
      nameLower === "save" ||
      nameLower === "touch" ||
      nameLower === "writecontent" ||
      (nameLower.includes("write") &&
        (nameLower.includes("file") || nameLower.includes("fs"))) ||
      toolName.endsWith("write_file") ||
      toolName.endsWith(".write_file")
    ) {
      const path = extractPath(rawParams);
      const content = extractContent(rawParams);
      return {
        kind: "file.write",
        category: "file",
        params: {
          ...rawParams,
          path,
          content,
          overwrite: rawParams.overwrite ?? true,
        },
        source: { ...source, toolName },
        rawToolName: toolName,
        rawParams,
      };
    }

    // 3. File List / Directory mappings
    if (
      nameLower === "listdirectory" ||
      nameLower === "listdir" ||
      nameLower === "listfiles" ||
      nameLower === "filelist" ||
      nameLower === "ls" ||
      toolName.endsWith("list_directory") ||
      toolName.endsWith(".list_directory")
    ) {
      const path = extractPath(rawParams) || ".";
      return {
        kind: "file.list",
        category: "file",
        params: {
          path,
          recursive: rawParams.recursive ?? false,
          ...rawParams,
        },
        source: { ...source, toolName },
        rawToolName: toolName,
        rawParams,
      };
    }

    // 4. File Delete mappings
    if (
      nameLower === "deletefile" ||
      nameLower === "delete" ||
      nameLower === "removefile" ||
      nameLower === "remove" ||
      nameLower === "unlink" ||
      nameLower === "rm" ||
      nameLower === "delfile"
    ) {
      const path = extractPath(rawParams);
      return {
        kind: "file.delete",
        category: "file",
        params: {
          path,
          ...rawParams,
        },
        source: { ...source, toolName },
        rawToolName: toolName,
        rawParams,
      };
    }

    // 5. Process Execution mappings
    if (
      nameLower === "executecommand" ||
      nameLower === "runcommand" ||
      nameLower === "runshellcommand" ||
      nameLower === "bash" ||
      nameLower === "sh" ||
      nameLower === "exec" ||
      nameLower === "terminal" ||
      nameLower === "shell"
    ) {
      const command = extractCommand(rawParams);
      return {
        kind: "process.exec",
        category: "process",
        params: {
          command,
          cwd: rawParams.cwd || rawParams.dir || rawParams.workingDirectory,
          timeoutMs: rawParams.timeoutMs || rawParams.timeout,
          ...rawParams,
        },
        source: { ...source, toolName },
        rawToolName: toolName,
        rawParams,
      };
    }

    // 6. Network Request mappings
    if (
      nameLower === "fetch" ||
      nameLower === "fetchurl" ||
      nameLower === "httprequest" ||
      nameLower === "http" ||
      nameLower === "curl" ||
      nameLower === "get" ||
      nameLower === "post"
    ) {
      const url = extractUrl(rawParams);
      return {
        kind: "network.request",
        category: "network",
        params: {
          ...rawParams,
          url,
          method: (rawParams.method || "GET").toUpperCase(),
          headers: rawParams.headers,
          body: rawParams.body,
        },
        source: { ...source, toolName },
        rawToolName: toolName,
        rawParams,
      };
    }

    // 7. Fallback for custom external tools
    const extractedPath = extractPath(rawParams);
    let fallbackCategory: ActionCategory = "custom";
    if (
      nameLower.startsWith("file") ||
      nameLower.startsWith("fs") ||
      Boolean(extractedPath)
    ) {
      fallbackCategory = "file";
    } else if (
      nameLower.startsWith("exec") ||
      nameLower.startsWith("cmd") ||
      nameLower.startsWith("shell") ||
      nameLower.startsWith("run") ||
      nameLower.startsWith("bash")
    ) {
      fallbackCategory = "process";
    } else if (
      nameLower.startsWith("net") ||
      nameLower.startsWith("web") ||
      nameLower.startsWith("http") ||
      nameLower.startsWith("fetch") ||
      nameLower.startsWith("curl")
    ) {
      fallbackCategory = "network";
    }

    const params: Record<string, any> = { ...rawParams };
    if (extractedPath && !params.path) {
      params.path = extractedPath;
    }

    const customKind =
      fallbackCategory === "file"
        ? `file.custom.${toolName}`
        : fallbackCategory === "process"
          ? `process.custom.${toolName}`
          : fallbackCategory === "network"
            ? `network.custom.${toolName}`
            : `custom.${source.type}.${toolName}`;

    return {
      kind: customKind,
      category: fallbackCategory,
      params,
      source: { ...source, toolName },
      rawToolName: toolName,
      rawParams,
    };
  }
}
