import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** Minimal slice of the Anthropic Messages API the agent needs (lets tests inject a fake LLM). */
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type TextBlock = { type: "text"; text: string };
export type ContentBlock = ToolUseBlock | TextBlock;
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type Message =
  | { role: "user"; content: string | ToolResultBlock[] }
  | { role: "assistant"; content: ContentBlock[] };
export type LlmTool = { name: string; description?: string; input_schema: Record<string, unknown> };

export interface Llm {
  create(p: {
    model: string;
    max_tokens: number;
    system: string;
    tools: LlmTool[];
    messages: Message[];
  }): Promise<{ stop_reason: string | null; content: ContentBlock[] }>;
}

export type ToolCall = { name: string; input: Record<string, unknown>; readOnly: boolean; destructive: boolean };

export type AgentResult = {
  answer: string;
  turns: number;
  toolCalls: { name: string; input: unknown; isError: boolean; rejected: boolean }[];
  hitTurnLimit: boolean;
};

export const SYSTEM_PROMPT = `You are an inventory operations assistant for Allo, a multi-warehouse reservation system.

Rules:
- Ground every claim in tool results. Never invent SKUs, warehouse codes, quantities or reservation ids.
- Check stock (check_stock / find_availability) before reserving. If a tool returns an error, read it and adapt.
- Check policy (search_policies) before acting on anything involving large orders, routing, holds or returns, and cite the policy source (file and section) when it affects your decision. If no policy is found, say so; do not assume one.
- Use a stable idempotencyKey per order line (e.g. "<order-ref>-<sku>-<warehouse>") and reuse it on retries.
- Reserve only what the task asks for. Call confirm_reservation ONLY if the task explicitly says to confirm.
- If the request is ambiguous or breaks a policy, stop and explain instead of guessing.
- Finish with a short plain-language summary of what you did and what remains.`;

/**
 * Tool-use loop over an MCP client. The tool list (names, descriptions, JSON schemas, annotations)
 * comes from the MCP server itself, so the agent and the server cannot drift apart.
 * Human-in-the-loop: any tool not marked readOnly must be approved by `approve`.
 */
export async function runAgent(opts: {
  llm: Llm;
  mcp: Client;
  task: string;
  model: string;
  approve: (call: ToolCall) => Promise<boolean>;
  maxTurns?: number;
}): Promise<AgentResult> {
  const { llm, mcp, task, model, approve, maxTurns = 8 } = opts;
  const listed = (await mcp.listTools()).tools;
  const meta = new Map(listed.map((t) => [t.name, t]));
  const tools: LlmTool[] = listed.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Record<string, unknown>,
  }));

  const messages: Message[] = [{ role: "user", content: task }];
  const toolCalls: AgentResult["toolCalls"] = [];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const res = await llm.create({ model, max_tokens: 1500, system: SYSTEM_PROMPT, tools, messages });
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      const answer = res.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer, turns: turn, toolCalls, hitTurnLimit: false };
    }

    const results: ToolResultBlock[] = [];
    for (const use of uses) {
      const t = meta.get(use.name);
      if (!t) {
        toolCalls.push({ name: use.name, input: use.input, isError: true, rejected: false });
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Unknown tool: ${use.name}`, is_error: true });
        continue;
      }
      const readOnly = t.annotations?.readOnlyHint === true;
      const destructive = t.annotations?.destructiveHint === true;
      if (!readOnly && !(await approve({ name: use.name, input: use.input, readOnly, destructive }))) {
        toolCalls.push({ name: use.name, input: use.input, isError: false, rejected: true });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: "The human operator rejected this action. Do not retry it; explain what you would have done.",
          is_error: true,
        });
        continue;
      }
      const out = await mcp.callTool({ name: use.name, arguments: use.input });
      const text = (out.content as { type: string; text?: string }[])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      const isError = out.isError === true;
      toolCalls.push({ name: use.name, input: use.input, isError, rejected: false });
      results.push({ type: "tool_result", tool_use_id: use.id, content: text, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  return { answer: "Stopped: reached the turn limit before finishing.", turns: maxTurns, toolCalls, hitTurnLimit: true };
}
