import { EventEmitter } from "node:events";
import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from "../types.js";

const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB maximum payload

export class JsonRpcStreamParser extends EventEmitter {
  private buffer = "";
  private isFramed: boolean | null = null;
  private expectedContentLength: number | null = null;

  write(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.buffer += text;

    if (this.buffer.length > MAX_MESSAGE_SIZE * 2) {
      this.emit(
        "error",
        new Error(
          `JSON-RPC buffer exceeded maximum limit (${MAX_MESSAGE_SIZE} bytes)`,
        ),
      );
      this.buffer = "";
      return;
    }

    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.buffer.length > 0) {
      // 1. If we haven't determined whether framing is Content-Length or newline-delimited:
      if (this.isFramed === null) {
        const trimmed = this.buffer.trimStart();
        if (trimmed.startsWith("Content-Length:")) {
          this.isFramed = true;
        } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          this.isFramed = false;
        } else {
          // Waiting for more data or skip whitespace
          if (this.buffer.includes("\n")) {
            const nlIdx = this.buffer.indexOf("\n");
            this.buffer = this.buffer.slice(nlIdx + 1);
            continue;
          }
          break;
        }
      }

      // 2. Content-Length framed parsing
      if (this.isFramed) {
        if (this.expectedContentLength === null) {
          const headerEnd = this.buffer.indexOf("\r\n\r\n");
          const headerEndAlt = this.buffer.indexOf("\n\n");
          const endIdx = headerEnd !== -1 ? headerEnd : headerEndAlt;
          const separatorLen = headerEnd !== -1 ? 4 : 2;

          if (endIdx === -1) break; // Incomplete header

          const header = this.buffer.slice(0, endIdx);
          const match = header.match(/Content-Length:\s*(\d+)/i);
          if (!match) {
            this.emit("error", new Error(`Invalid JSON-RPC header: ${header}`));
            this.buffer = this.buffer.slice(endIdx + separatorLen);
            continue;
          }

          this.expectedContentLength = parseInt(match[1], 10);
          this.buffer = this.buffer.slice(endIdx + separatorLen);
        }

        if (this.expectedContentLength !== null) {
          if (this.buffer.length < this.expectedContentLength) {
            break; // Incomplete payload
          }

          const rawPayload = this.buffer.slice(0, this.expectedContentLength);
          this.buffer = this.buffer.slice(this.expectedContentLength);
          this.expectedContentLength = null;
          this.isFramed = null; // reset for next message

          this.dispatchParsed(rawPayload);
        }
      } else {
        // 3. Newline-delimited JSON parsing
        const newlineIdx = this.buffer.indexOf("\n");
        if (newlineIdx === -1) break; // Incomplete line

        const rawLine = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);

        if (rawLine.length > 0) {
          this.dispatchParsed(rawLine);
        }
      }
    }
  }

  private dispatchParsed(raw: string): void {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        this.emit("message", parsed as JsonRpcMessage);
      } else {
        this.emit(
          "error",
          new Error(`Invalid JSON-RPC payload: must be object or array`),
        );
      }
    } catch (err: any) {
      this.emit("error", new Error(`Malformed JSON-RPC frame: ${err.message}`));
    }
  }
}

export function serializeJsonRpc(
  msg: JsonRpcMessage,
  useHeader: boolean = false,
): string {
  const json = JSON.stringify(msg);
  if (useHeader) {
    const len = Buffer.byteLength(json, "utf8");
    return `Content-Length: ${len}\r\n\r\n${json}`;
  }
  return `${json}\n`;
}

export function createJsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: any,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

export function isJsonRpcRequest(msg: any): msg is JsonRpcRequest {
  return (
    msg &&
    msg.jsonrpc === "2.0" &&
    typeof msg.method === "string" &&
    msg.id !== undefined
  );
}

export function isJsonRpcNotification(msg: any): msg is JsonRpcNotification {
  return (
    msg &&
    msg.jsonrpc === "2.0" &&
    typeof msg.method === "string" &&
    msg.id === undefined
  );
}

export function isJsonRpcResponse(msg: any): msg is JsonRpcResponse {
  return (
    msg &&
    msg.jsonrpc === "2.0" &&
    msg.id !== undefined &&
    (msg.result !== undefined || msg.error !== undefined)
  );
}
