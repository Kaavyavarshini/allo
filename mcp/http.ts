import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAlloServer, type Deps } from "./server";

/**
 * Stateless Streamable-HTTP handler: a fresh server + transport per request, so it
 * works on serverless hosts. Authentication is enforced by middleware.ts before this runs.
 */
export async function handleMcpRequest(req: Request, deps: Deps, actor = "http"): Promise<Response> {
  const server = createAlloServer(deps, actor);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
