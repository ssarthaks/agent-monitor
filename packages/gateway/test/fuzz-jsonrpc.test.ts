import { describe, it, expect } from "vitest";
import { JsonRpcStreamParser, serializeJsonRpc } from "../src/index.js";
import crypto from "node:crypto";

describe("JSON-RPC Stream Parser Fuzzing & Mutation Tests", () => {
  it("never crashes on random arbitrary byte streams", () => {
    const parser = new JsonRpcStreamParser();
    let errorCount = 0;
    parser.on("error", () => {
      errorCount++;
    });

    // Feed 200 random binary chunks
    for (let i = 0; i < 200; i++) {
      const len = Math.floor(Math.random() * 256) + 1;
      const buf = crypto.randomBytes(len);
      expect(() => parser.write(buf)).not.toThrow();
    }
  });

  it("recovers and successfully parses valid frames after receiving garbage input", () => {
    const parser = new JsonRpcStreamParser();
    const received: any[] = [];
    parser.on("message", (msg) => received.push(msg));
    parser.on("error", () => {}); // swallow errors

    // 1. Inject malformed / garbage lines
    parser.write("NOT_A_JSON_RPC_MESSAGE\n");
    parser.write("{ bad json: 12345 \n");
    parser.write("Content-Length: abc\r\n\r\n");
    parser.write("\0\0\0\0\n");

    // 2. Inject valid message
    const validMsg = { jsonrpc: "2.0" as const, id: 999, method: "tools/list" };
    parser.write(JSON.stringify(validMsg) + "\n");

    expect(received.length).toBe(1);
    expect(received[0].id).toBe(999);
    expect(received[0].method).toBe("tools/list");
  });

  it("handles randomized byte chunk fragmentation of valid framed messages", () => {
    const parser = new JsonRpcStreamParser();
    const received: any[] = [];
    parser.on("message", (msg) => received.push(msg));

    const originalMsg = {
      jsonrpc: "2.0" as const,
      id: "fuzz_msg_1",
      result: {
        payload: "Fuzz payload with special symbols: 🛡️ 🔥 <script>alert(1)</script> \u0000",
        numbers: [1, 2, 3, 4, 5],
      },
    };

    const framed = serializeJsonRpc(originalMsg, true); // Content-Length framed
    const fullBuffer = Buffer.from(framed, "utf8");

    // Chunk size between 1 and 7 bytes
    let offset = 0;
    while (offset < fullBuffer.length) {
      const chunkSize = Math.min(Math.floor(Math.random() * 7) + 1, fullBuffer.length - offset);
      const chunk = fullBuffer.subarray(offset, offset + chunkSize);
      parser.write(chunk);
      offset += chunkSize;
    }

    expect(received.length).toBe(1);
    expect(received[0].id).toBe("fuzz_msg_1");
    expect(received[0].result.payload).toContain("🛡️");
  });

  it("handles fuzz mutations on JSON structure without throwing unhandled exceptions", () => {
    const parser = new JsonRpcStreamParser();
    parser.on("error", () => {});
    const base = '{"jsonrpc":"2.0","id":123,"method":"test"}\n';

    // Mutate individual characters
    for (let i = 0; i < base.length; i++) {
      const mutated = base.substring(0, i) + "X" + base.substring(i + 1);
      expect(() => parser.write(mutated)).not.toThrow();
    }
  });
});
