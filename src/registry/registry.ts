import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AntTool } from "../shared/tools/tool";

export interface Registry {
  // Query tools in the registry
  queryTools(query: string, limit?: number): Promise<AntTool[]>;

  // Add a tool to the registry.
  addTool(tool: AntTool): Promise<AntTool>;

  // add server adds all tools from an MCP server to the registry
  addServer(client: Client, serverUrl: string): Promise<AntTool[]>;

  // List all tools in the registry.
  listTools(): Promise<AntTool[]>;

  // deletes a tool from the registry
  deleteTool(name: string): Promise<boolean>;
}
