import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveSafeWorkspacePath } from "../src/tools/guardrails.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("Path Resolver Fuzzing & Mutation Tests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-ws-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("never throws unhandled exceptions on random fuzzed string inputs", () => {
    const chars = [
      ".", "/", "\\", "%", "2", "e", "f", "\0", "C", ":", "a", "b", "c",
      " ", "\t", "\n", "\r", "..", "..\\", "../", "%2e", "%2f", "%252e",
      "~", "$", "*", "?", '"', "<", ">", "|", "🔥", "🛡️", "\uFEFF",
    ];

    for (let iteration = 0; iteration < 500; iteration++) {
      // Build random pseudo-path
      let testPath = "";
      const len = Math.floor(Math.random() * 8) + 1;
      for (let i = 0; i < len; i++) {
        testPath += chars[Math.floor(Math.random() * chars.length)];
      }

      let res: any;
      expect(() => {
        res = resolveSafeWorkspacePath(testPath, tmpDir);
      }).not.toThrow();

      expect(typeof res.isOutsideWorkspace).toBe("boolean");
      expect(typeof res.safePath).toBe("string");

      // Invariant: If marked NOT outside workspace, the path MUST actually be within tmpDir
      if (!res.isOutsideWorkspace) {
        const rel = path.relative(tmpDir, res.safePath);
        expect(rel.startsWith("..")).toBe(false);
        expect(path.isAbsolute(rel)).toBe(false);
      }
    }
  });

  it("consistently flags traversal permutations as outside workspace", () => {
    const traversals = [
      "../etc/passwd",
      "..\\..\\etc\\passwd",
      "/etc/shadow",
      "C:\\boot.ini",
      "\\\\smb\\share",
      "foo/../../bar/../../etc",
      "%2e%2e%2f%2e%2e%2f",
      "%252e%252e%252f",
      "sub/dir/../../../../../../../etc",
      "safe.txt\0/../escape",
    ];

    for (const trav of traversals) {
      const res = resolveSafeWorkspacePath(trav, tmpDir);
      expect(res.isOutsideWorkspace).toBe(true);
    }
  });

  it("allows legitimately safe paths nested within workspace", () => {
    const safePaths = [
      "file.txt",
      "src/index.ts",
      "nested/deeply/down/folder/app.js",
      "./local.json",
      "docs/readme.md",
    ];

    for (const p of safePaths) {
      const res = resolveSafeWorkspacePath(p, tmpDir);
      expect(res.isOutsideWorkspace).toBe(false);
      const rel = path.relative(tmpDir, res.safePath);
      expect(rel.startsWith("..")).toBe(false);
    }
  });
});
