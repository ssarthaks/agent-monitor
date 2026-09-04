import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-monitor/core": path.resolve(
        __dirname,
        "packages/core/src/index.ts",
      ),
      "@agent-monitor/agent": path.resolve(
        __dirname,
        "packages/agent/src/index.ts",
      ),
      "@agent-monitor/gateway": path.resolve(
        __dirname,
        "packages/gateway/src/index.ts",
      ),
      "@agent-monitor/server": path.resolve(
        __dirname,
        "packages/server/src/index.ts",
      ),
      "@agent-monitor/cli": path.resolve(
        __dirname,
        "packages/cli/src/index.ts",
      ),
    },
  },
  test: {
    globals: true,
  },
});
