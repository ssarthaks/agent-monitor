import { EventEmitter } from "node:events";
import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from "../types.js";

const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB maximum payload
const MAX_HEADER_SIZE = 8 * 1024; // 8 KB maximum header

export class JsonRpcStreamParser extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);
  private isFramed: boolean | null = null;
  private expectedContentLength: number | null = null;

  write(chunk: Buffer | string): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (buf.length === 0) return;

    this.buffer =
      this.buffer.length === 0 ? buf : Buffer.concat([this.buffer, buf]);

    if (this.buffer.length > MAX_MESSAGE_SIZE * 2) {
      this.emit(
        "error",
        new Error(
          `JSON-RPC buffer exceeded maximum limit (${MAX_MESSAGE_SIZE} bytes)`,
        ),
      );
      this.buffer = Buffer.alloc(0);
      this.isFramed = null;
      this.expectedContentLength = null;
      return;
    }

    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.buffer.length > 0) {
      // 1. If we haven't determined whether framing is Content-Length or newline-delimited:
      if (this.isFramed === null) {
        // Skip leading whitespace (spaces, tabs, CR, LF)
        let wsCount = 0;
        while (wsCount < this.buffer.length) {
          const b = this.buffer[wsCount];
          if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a) {
            wsCount++;
          } else {
            break;
          }
        }
        if (wsCount > 0) {
          this.buffer = this.buffer.subarray(wsCount);
        }
        if (this.buffer.length === 0) break;

        const firstByte = this.buffer[0];
        if (firstByte === 0x7b || firstByte === 0x5b) {
          // '{' or '[' -> newline-delimited JSON
          this.isFramed = false;
        } else {
          // Check for Content-Length header or other headers
          const prefix = this.buffer
            .subarray(0, Math.min(15, this.buffer.length))
            .toString("latin1")
            .toLowerCase();
          if ("content-length:".startsWith(prefix)) {
            // Might be incomplete "Content-Length:", wait for more data if prefix matches
            if (this.buffer.length < 15) {
              break;
            }
            this.isFramed = true;
          } else if (prefix.startsWith("content-")) {
            this.isFramed = true;
          } else {
            // Check if there's a header separator or newline
            const nlIdx = this.buffer.indexOf(0x0a);
            if (nlIdx !== -1) {
              const line = this.buffer
                .subarray(0, nlIdx)
                .toString("utf8")
                .trim();
              this.buffer = this.buffer.subarray(nlIdx + 1);
              if (line.length > 0) {
                this.emit(
                  "error",
                  new Error(`Unrecognized JSON-RPC framing: ${line}`),
                );
              }
              continue;
            }
            break; // wait for more bytes
          }
        }
      }

      // 2. Content-Length framed parsing
      if (this.isFramed) {
        if (this.expectedContentLength === null) {
          const crlfcrlf = this.buffer.indexOf("\r\n\r\n");
          const lflf = this.buffer.indexOf("\n\n");
          let headerEnd = -1;
          let separatorLen = 0;

          if (crlfcrlf !== -1 && (lflf === -1 || crlfcrlf < lflf)) {
            headerEnd = crlfcrlf;
            separatorLen = 4;
          } else if (lflf !== -1) {
            headerEnd = lflf;
            separatorLen = 2;
          }

          if (headerEnd === -1) {
            if (this.buffer.length > MAX_HEADER_SIZE) {
              this.emit(
                "error",
                new Error(
                  `JSON-RPC header exceeded maximum size (${MAX_HEADER_SIZE} bytes)`,
                ),
              );
              this.buffer = Buffer.alloc(0);
              this.isFramed = null;
            }
            break; // Incomplete header
          }

          const header = this.buffer.subarray(0, headerEnd).toString("latin1");
          const match = header.match(/Content-Length:\s*([^\r\n;]+)/i);
          if (!match) {
            this.emit(
              "error",
              new Error(
                `Invalid JSON-RPC header (missing Content-Length): ${header}`,
              ),
            );
            this.buffer = this.buffer.subarray(headerEnd + separatorLen);
            this.isFramed = null;
            continue;
          }

          const rawLen = match[1].trim();
          const len = parseInt(rawLen, 10);
          if (
            !/^\d+$/.test(rawLen) ||
            isNaN(len) ||
            len < 0 ||
            len > MAX_MESSAGE_SIZE
          ) {
            this.emit(
              "error",
              new Error(`Invalid JSON-RPC Content-Length: ${rawLen}`),
            );
            this.buffer = Buffer.alloc(0);
            this.isFramed = null;
            this.expectedContentLength = null;
            break;
          }

          this.expectedContentLength = len;
          this.buffer = this.buffer.subarray(headerEnd + separatorLen);
        }

        if (this.expectedContentLength !== null) {
          if (this.buffer.length < this.expectedContentLength) {
            break; // Incomplete payload, wait for more data
          }

          const rawPayloadBuf = this.buffer.subarray(
            0,
            this.expectedContentLength,
          );
          this.buffer = this.buffer.subarray(this.expectedContentLength);
          this.expectedContentLength = null;
          this.isFramed = null; // Reset for next message

          const rawPayload = rawPayloadBuf.toString("utf8");
          this.dispatchParsed(rawPayload);
        }
      } else {
        // 3. Newline-delimited JSON parsing
        const newlineIdx = this.buffer.indexOf(0x0a);
        if (newlineIdx === -1) break; // Incomplete line

        const rawLineBuf = this.buffer.subarray(0, newlineIdx);
        this.buffer = this.buffer.subarray(newlineIdx + 1);
        this.isFramed = null; // Reset for next message

        const rawLine = rawLineBuf.toString("utf8").trim();
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
