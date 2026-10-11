import Anthropic from "@anthropic-ai/sdk";
import type { Llm } from "./run";

/** Adapter from the Anthropic SDK to the small Llm interface the agent uses. */
export function anthropicLlm(apiKey = process.env.ANTHROPIC_API_KEY): Llm {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  return {
    async create(p) {
      const r = await client.messages.create({
        model: p.model,
        max_tokens: p.max_tokens,
        system: p.system,
        tools: p.tools as Anthropic.Tool[],
        messages: p.messages as Anthropic.MessageParam[],
      });
      return { stop_reason: r.stop_reason, content: r.content as never };
    },
  };
}
