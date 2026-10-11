/**
 * Local MCP server over stdio, for Claude Desktop / Cursor / Claude Code.
 * Run: npm run mcp:stdio
 * IMPORTANT: stdout is the protocol channel. Never console.log here; use lib/logger (stderr).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAlloServer } from "./server";
import { prismaDeps } from "./deps";
import { logger } from "../lib/logger";

async function main() {
  const server = createAlloServer(prismaDeps(), "stdio");
  await server.connect(new StdioServerTransport());
  logger.info("allo MCP server ready on stdio");
}

main().catch((e) => {
  logger.error("fatal", { error: String(e) });
  process.exit(1);
});
