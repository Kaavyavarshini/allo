import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", testTimeout: 30000, fileParallelism: false, include: ["tests/{auth,observability,rag,mcp,agent}.test.ts"] } });
