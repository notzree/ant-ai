import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { Registry } from "../registry";

// Colony implements the registry interface for managing tools and collecting MCP Servers.
export class ProductionRegistry implements Registry {
  private vectorStorer: VectorStore;
  private toolStore: ToolStore;

  queryTools(query: string, limit?: number): Promise<ToolWithServerInfo[]> {}
  addTool(tool: MCPTool, server: MCPServer): Promise<MCPTool> {}
  addServer(serverUrl: string, authToken?: string): Promise<MCPTool[]> {}
  listTools(): Promise<MCPTool[]> {}
  deleteTool(name: string): Promise<boolean> {}
}
