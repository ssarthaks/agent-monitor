import { describe, it, expect } from "vitest";
import { ActionNormalizer, ActionSource } from "../src/index.js";

describe("Action Normalizer (V0.3)", () => {
  const mcpSource: ActionSource = {
    type: "mcp",
    server: "filesystem",
    transport: "stdio",
    client: "claude-code",
  };

  it("normalizes read_file into canonical file.read with path aliases", () => {
    const action1 = ActionNormalizer.normalize(
      "read_file",
      { path: "/workspace/src/app.ts", start_line: 10, end_line: 20 },
      mcpSource,
    );
    expect(action1.kind).toBe("file.read");
    expect(action1.category).toBe("file");
    expect(action1.params.path).toBe("/workspace/src/app.ts");
    expect(action1.source.type).toBe("mcp");
    expect(action1.source.toolName).toBe("read_file");

    // file_path alias
    const action2 = ActionNormalizer.normalize(
      "readFile",
      { file_path: ".env" },
      mcpSource,
    );
    expect(action2.kind).toBe("file.read");
    expect(action2.params.path).toBe(".env");

    // uri alias (with file:// prefix)
    const action3 = ActionNormalizer.normalize(
      "fs_read",
      { uri: "file:///etc/hosts" },
      mcpSource,
    );
    expect(action3.kind).toBe("file.read");
    expect(action3.params.path).toBe("/etc/hosts");
  });

  it("normalizes write_file into canonical file.write with content aliases", () => {
    const action = ActionNormalizer.normalize(
      "write_file",
      { path: "src/main.ts", text: 'console.log("hello")' },
      mcpSource,
    );
    expect(action.kind).toBe("file.write");
    expect(action.category).toBe("file");
    expect(action.params.path).toBe("src/main.ts");
    expect(action.params.content).toBe('console.log("hello")');
  });

  it("normalizes list_directory into canonical file.list", () => {
    const action = ActionNormalizer.normalize(
      "list_directory",
      { path: "src/", recursive: true },
      mcpSource,
    );
    expect(action.kind).toBe("file.list");
    expect(action.category).toBe("file");
    expect(action.params.path).toBe("src/");
    expect(action.params.recursive).toBe(true);
  });

  it("normalizes execute_command into canonical process.exec with argument array", () => {
    const action = ActionNormalizer.normalize(
      "execute_command",
      { command: "npm test", cwd: "/project" },
      { type: "mcp", server: "bash" },
    );
    expect(action.kind).toBe("process.exec");
    expect(action.category).toBe("process");
    expect(action.params.command).toBe("npm test");
    expect(action.params.cwd).toBe("/project");

    // Command with binary + args array
    const action2 = ActionNormalizer.normalize(
      "bash",
      { cmd: "git", args: ["push", "origin", "main"] },
      { type: "mcp", server: "bash" },
    );
    expect(action2.kind).toBe("process.exec");
    expect(action2.params.command).toBe("git push origin main");
  });

  it("normalizes fetch into canonical network.request", () => {
    const action = ActionNormalizer.normalize(
      "fetch",
      {
        url: "https://api.example.com/data",
        method: "post",
        body: '{"test":1}',
      },
      { type: "mcp", server: "fetch" },
    );
    expect(action.kind).toBe("network.request");
    expect(action.category).toBe("network");
    expect(action.params.url).toBe("https://api.example.com/data");
    expect(action.params.method).toBe("POST");
  });

  it("normalizes custom unrecognized tools with prefixed kind and category", () => {
    const action = ActionNormalizer.normalize(
      "deploy_lambda",
      { functionName: "auth-handler", stage: "prod" },
      { type: "sdk", runtime: "custom-orchestrator" },
    );
    expect(action.kind).toBe("custom.sdk.deploy_lambda");
    expect(action.category).toBe("custom");
    expect(action.params.functionName).toBe("auth-handler");
  });
});
