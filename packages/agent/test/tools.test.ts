import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readFileTool } from "../src/tools/file-read.js";
import { writeFileTool } from "../src/tools/file-write.js";
import { listFilesTool } from "../src/tools/file-list.js";
import { runCommandTool } from "../src/tools/process-exec.js";
import { resolveSafeWorkspacePath } from "../src/tools/guardrails.js";

describe("Agent Tools & Security Guardrails", () => {
  let tmpDir: string;
  const ctx = {
    sessionId: "test_ses",
    agentId: "test_agent",
    workspaceRoot: "",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-monitor-test-"));
    ctx.workspaceRoot = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("safely writes and reads file within workspace", async () => {
    const writeRes = await writeFileTool.execute(
      { path: "test.txt", content: "Hello Agent Monitor!\nLine 2\nLine 3" },
      ctx,
    );
    expect(writeRes.isNewFile).toBe(true);
    expect(writeRes.bytesWritten).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpDir, "test.txt"))).toBe(true);

    const readRes = await readFileTool.execute(
      { path: "test.txt", startLine: 2, endLine: 3 },
      ctx,
    );
    expect(readRes.content).toBe("Line 2\nLine 3");
    expect(readRes.totalLines).toBe(3);
  });

  it("generates unified diff on file modification", async () => {
    await writeFileTool.execute(
      { path: "code.js", content: "const a = 1;" },
      ctx,
    );
    const updateRes = await writeFileTool.execute(
      { path: "code.js", content: "const a = 2;\nconst b = 3;" },
      ctx,
    );
    expect(updateRes.isNewFile).toBe(false);
    expect(updateRes.diff).toContain("-const a = 1;");
    expect(updateRes.diff).toContain("+const a = 2;");
    expect(updateRes.diff).toContain("+const b = 3;");
  });

  it("lists files while ignoring node_modules and .git", async () => {
    fs.writeFileSync(path.join(tmpDir, "index.ts"), "console.log()");
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src/app.ts"), "export const a = 1");
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.writeFileSync(path.join(tmpDir, "node_modules/dummy.js"), "dummy");

    const listRes = await listFilesTool.execute({ recursive: true }, ctx);
    const names = listRes.entries.map((e) => e.name);
    expect(names).toContain("index.ts");
    expect(names).toContain("app.ts");
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain("dummy.js");
  });

  it("executes shell commands and captures stdout/stderr and exit code", async () => {
    const res = await runCommandTool.execute(
      { command: 'echo "hello from cli"' },
      ctx,
    );
    expect(res.stdout.trim()).toBe("hello from cli");
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
  });

  it("handles command failure with non-zero exit code", async () => {
    const res = await runCommandTool.execute({ command: "exit 42" }, ctx);
    expect(res.exitCode).toBe(42);
    expect(res.timedOut).toBe(false);
  });

  it("kills and flags command that exceeds timeout", async () => {
    const res = await runCommandTool.execute(
      { command: "sleep 2", timeoutMs: 150 },
      ctx,
    );
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBe(124);
    expect(res.stderr).toContain("timed out");
  });

  it("blocks path traversal outside workspace", async () => {
    const traversalCheck = resolveSafeWorkspacePath("../../etc/passwd", tmpDir);
    expect(traversalCheck.isOutsideWorkspace).toBe(true);

    await expect(
      readFileTool.execute({ path: "../../etc/passwd" }, ctx),
    ).rejects.toThrow(/Security Violation/);
  });

  it("ADVERSARIAL: blocks URL-encoded and double-encoded path traversal attempts", async () => {
    // 1. Single URL-encoded %2e%2e%2f
    const check1 = resolveSafeWorkspacePath("..%2f..%2fetc%2fpasswd", tmpDir);
    expect(check1.isOutsideWorkspace).toBe(true);

    await expect(
      readFileTool.execute({ path: "..%2f..%2fetc%2fpasswd" }, ctx),
    ).rejects.toThrow(/Security Violation/);

    // 2. Nested / double URL-encoded %252e%252e%252f
    const check2 = resolveSafeWorkspacePath(
      "%252e%252e%252f%252e%252e%252fetc%252fshadow",
      tmpDir,
    );
    expect(check2.isOutsideWorkspace).toBe(true);

    await expect(
      readFileTool.execute(
        { path: "%252e%252e%252f%252e%252e%252fetc%252fshadow" },
        ctx,
      ),
    ).rejects.toThrow(/Security Violation/);
  });

  it("ADVERSARIAL: blocks backslash path traversal attempts across platforms", async () => {
    // Windows-style backslash traversal on POSIX / Unix platforms
    const check1 = resolveSafeWorkspacePath(
      "subdir\\..\\..\\..\\etc\\passwd",
      tmpDir,
    );
    expect(check1.isOutsideWorkspace).toBe(true);

    await expect(
      readFileTool.execute({ path: "subdir\\..\\..\\..\\etc\\passwd" }, ctx),
    ).rejects.toThrow(/Security Violation/);

    const check2 = resolveSafeWorkspacePath(
      "..\\..\\windows\\system32",
      tmpDir,
    );
    expect(check2.isOutsideWorkspace).toBe(true);
  });

  it("rejects file writes exceeding 2MB limit", async () => {
    const largeContent = "A".repeat(2.5 * 1024 * 1024);
    await expect(
      writeFileTool.execute({ path: "large.txt", content: largeContent }, ctx),
    ).rejects.toThrow(/exceeds maximum size/);
  });
});
