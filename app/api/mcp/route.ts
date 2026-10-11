import { handleMcpRequest } from "@/mcp/http";
import { prismaDeps } from "@/mcp/deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Remote MCP endpoint (Streamable HTTP). Protected by ALLO_API_KEY in middleware.ts.
export async function POST(req: Request) {
  return handleMcpRequest(req, prismaDeps());
}

const notAllowed = () =>
  new Response(JSON.stringify({ error: "method not allowed (stateless server)" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
export const GET = notAllowed;
export const DELETE = notAllowed;
