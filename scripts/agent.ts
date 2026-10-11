/**
 * Run the inventory agent from the terminal.
 *   npm run agent -- "Reserve 5 Wireless Mouse for order ORD-77 from the best warehouse"
 *   npm run agent -- --yes "..."     # auto-approve write actions (default: ask first)
 */
import readline from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAlloServer } from "../mcp/server";
import { prismaDeps } from "../mcp/deps";
import { runAgent } from "../lib/agent/run";
import { anthropicLlm } from "../lib/agent/anthropic";

async function main() {
  const args = process.argv.slice(2);
  const auto = args.includes("--yes");
  const task = args.filter((a) => a !== "--yes").join(" ").trim();
  if (!task) {
    console.error('Usage: npm run agent -- [--yes] "<task>"');
    process.exit(1);
  }

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createAlloServer(prismaDeps(), "agent").connect(serverT);
  const mcp = new Client({ name: "allo-agent", version: "1.0.0" });
  await mcp.connect(clientT);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const result = await runAgent({
    llm: anthropicLlm(),
    mcp,
    task,
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    approve: async (c) => {
      if (auto) return true;
      const tag = c.destructive ? " [IRREVERSIBLE]" : "";
      const a = await rl.question(`\nApprove ${c.name}${tag}?\n${JSON.stringify(c.input, null, 2)}\n[y/N] `);
      return a.trim().toLowerCase() === "y";
    },
  });
  rl.close();

  console.log("\n--- tool calls ---");
  for (const t of result.toolCalls) {
    console.log(`${t.rejected ? "REJECTED" : t.isError ? "ERROR   " : "ok      "} ${t.name} ${JSON.stringify(t.input)}`);
  }
  console.log(`\n--- answer (${result.turns} turn${result.turns === 1 ? "" : "s"}) ---\n${result.answer}`);
  await mcp.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
