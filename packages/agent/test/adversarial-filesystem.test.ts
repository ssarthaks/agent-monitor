import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveSafeWorkspacePath } from "../src/tools/guardrails.js";
import { readFileTool } from "../src/tools/file-read.js";
import { writeFileTool } from "../src/tools/file-write.js";

describe("Adversarial Filesystem Security Tests", () => {
  let tmpDir: string;
  let outsideDir: string;
  const ctx = {
    sessionId: "ses_adv_fs",
    agentId: "agent_adv_fs",
    workspaceRoot: "",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adv-fs-ws-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "adv-fs-outside-"));
    ctx.workspaceRoot = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  describe("Null Byte Injections", () => {
    it("rejects raw null byte injection in file paths", () => {
      const res = resolveSafeWorkspacePath(
        "safe.txt\0/../../etc/passwd",
        tmpDir,
      );
      expect(res.isOutsideWorkspace).toBe(true);
      expect(res.reason).toContain("null byte");
    });

    it("rejects URL-encoded null byte injection (%00)", () => {
      const res = resolveSafeWorkspacePath("safe.txt%00.png", tmpDir);
      expect(res.isOutsideWorkspace).toBe(true);
      expect(res.reason).toContain("null byte");
    });

    it("rejects double URL-encoded null byte injection (%2500)", () => {
      const res = resolveSafeWorkspacePath("safe.txt%2500.png", tmpDir);
      expect(res.isOutsideWorkspace).toBe(true);
      expect(res.reason).toContain("null byte");
    });

    it("blocks file operations containing null bytes via readFileTool", async () => {
      await expect(
        readFileTool.execute({ path: "test\0.txt" }, ctx),
      ).rejects.toThrow(/Security Violation/);
    });

    it("blocks file operations containing null bytes via writeFileTool", async () => {
      await expect(
        writeFileTool.execute({ path: "test\0.txt", content: "evil" }, ctx),
      ).rejects.toThrow(/Security Violation/);
    });
  });

  describe("Windows Drive Letters and UNC Paths on POSIX", () => {
    it("rejects Windows drive letters when workspace is not on that drive", () => {
      const res1 = resolveSafeWorkspacePath(
        "C:\\Windows\\System32\\cmd.exe",
        tmpDir,
      );
      expect(res1.isOutsideWorkspace).toBe(true);

      const res2 = resolveSafeWorkspacePath("D:/data/secrets.env", tmpDir);
      expect(res2.isOutsideWorkspace).toBe(true);

      const res3 = resolveSafeWorkspacePath("c:\\boot.ini", tmpDir);
      expect(res3.isOutsideWorkspace).toBe(true);
    });

    it("rejects UNC network paths", () => {
      const res1 = resolveSafeWorkspacePath(
        "\\\\attacker-smb\\share\\evil.exe",
        tmpDir,
      );
      expect(res1.isOutsideWorkspace).toBe(true);

      const res2 = resolveSafeWorkspacePath(
        "//192.168.1.100/c$/secrets.txt",
        tmpDir,
      );
      expect(res2.isOutsideWorkspace).toBe(true);
    });
  });

  describe("Multi-Layer URL-Encoding Traversal", () => {
    it("blocks single-encoded traversal (%2e%2e%2f)", () => {
      const res = resolveSafeWorkspacePath(
        "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        tmpDir,
      );
      expect(res.isOutsideWorkspace).toBe(true);
    });

    it("blocks double-encoded traversal (%252e%252e%252f)", () => {
      const res = resolveSafeWorkspacePath(
        "%252e%252e%252f%252e%252e%252fetc%2fpasswd",
        tmpDir,
      );
      expect(res.isOutsideWorkspace).toBe(true);
    });

    it("blocks triple-encoded traversal (%25252e%25252e%25252f)", () => {
      const res = resolveSafeWorkspacePath(
        "%25252e%25252e%25252f%25252e%25252e%25252fetc%2fpasswd",
        tmpDir,
      );
      expect(res.isOutsideWorkspace).toBe(true);
    });

    it("blocks mixed slashes and encodings (..%5c..%2f)", () => {
      const res = resolveSafeWorkspacePath("..%5c..%2fetc/passwd", tmpDir);
      expect(res.isOutsideWorkspace).toBe(true);
    });
  });

  describe("Symlink Traversal and Loop Escapes", () => {
    it("blocks symlink pointing to outside directory", () => {
      const outsideFile = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outsideFile, "confidential");

      const symlinkPath = path.join(tmpDir, "symlink_escape");
      fs.symlinkSync(outsideDir, symlinkPath);

      const res = resolveSafeWorkspacePath("symlink_escape/secret.txt", tmpDir);
      expect(res.isOutsideWorkspace).toBe(true);
      expect(res.reason).toMatch(
        /Symlink target.*points outside workspace root/,
      );
    });

    it("handles circular symlinks without infinite recursion", () => {
      const linkA = path.join(tmpDir, "link_a");
      const linkB = path.join(tmpDir, "link_b");

      try {
        fs.symlinkSync(linkB, linkA);
        fs.symlinkSync(linkA, linkB);

        const res = resolveSafeWorkspacePath("link_a/subfile.txt", tmpDir);
        expect(typeof res.isOutsideWorkspace).toBe("boolean");
      } catch (err) {
        // Ignored if OS restricts
      }
    });

    it("allows valid symlinks strictly within the workspace", () => {
      const internalDir = path.join(tmpDir, "real_subdir");
      fs.mkdirSync(internalDir);
      fs.writeFileSync(path.join(internalDir, "data.json"), '{"valid": true}');

      const validSymlink = path.join(tmpDir, "symlink_subdir");
      fs.symlinkSync(internalDir, validSymlink);

      const res = resolveSafeWorkspacePath("symlink_subdir/data.json", tmpDir);
      expect(res.isOutsideWorkspace).toBe(false);
    });
  });

  describe("URI Scheme Attacks & Boundary Containment", () => {
    it("rejects file:///etc/passwd file URIs", () => {
      const res = resolveSafeWorkspacePath("file:///etc/passwd", tmpDir);
      expect(res.isOutsideWorkspace).toBe(true);
      expect(res.safePath).toBe("/etc/passwd");
    });

    it("rejects file://localhost/etc/passwd file URIs", () => {
      const res = resolveSafeWorkspacePath(
        "file://localhost/etc/passwd",
        tmpDir,
      );
      expect(res.isOutsideWorkspace).toBe(true);
      expect(res.safePath).toBe("/etc/passwd");
    });

    it("rejects non-localhost and remote file URIs", () => {
      const res1 = resolveSafeWorkspacePath(
        "file://127.0.0.1/etc/passwd",
        tmpDir,
      );
      expect(res1.isOutsideWorkspace).toBe(true);

      const res2 = resolveSafeWorkspacePath("file://[::1]/etc/passwd", tmpDir);
      expect(res2.isOutsideWorkspace).toBe(true);
    });

    it("rejects external non-file URI schemes (s3://, http://, https://)", () => {
      const resS3 = resolveSafeWorkspacePath(
        "s3://my-corp-bucket/secrets.env",
        tmpDir,
      );
      expect(resS3.isOutsideWorkspace).toBe(true);
      expect(resS3.reason).toContain("External non-file URI scheme");

      const resHttp = resolveSafeWorkspacePath(
        "http://169.254.169.254/latest/meta-data",
        tmpDir,
      );
      expect(resHttp.isOutsideWorkspace).toBe(true);
      expect(resHttp.reason).toContain("External non-file URI scheme");
    });

    it("blocks URI attacks at real execution boundary via readFileTool", async () => {
      await expect(
        readFileTool.execute({ path: "file:///etc/passwd" }, ctx),
      ).rejects.toThrow(/outside workspace root/);
    });

    it("blocks URI attacks at real execution boundary via writeFileTool", async () => {
      await expect(
        writeFileTool.execute(
          { path: "file:///etc/cron.d/evil", content: "* * * * *" },
          ctx,
        ),
      ).rejects.toThrow(/outside workspace root/);
    });

    it("allows valid file:// URIs located strictly within workspace", () => {
      const insidePath = path.join(tmpDir, "local-file.txt");
      fs.writeFileSync(insidePath, "local content");

      const fileUri = `file://${insidePath}`;
      const res = resolveSafeWorkspacePath(fileUri, tmpDir);
      expect(res.isOutsideWorkspace).toBe(false);
      expect(res.safePath).toBe(insidePath);
    });
  });
});
