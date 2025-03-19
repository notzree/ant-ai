import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@anthropic-ai/sdk/resources/index.mjs";
import { MCPServer } from "../mcpServer/server";
// Extended Tool interface to include server information in metadata
export interface ToolWithServerInfo {
  tool: Tool;
  server: MCPServer;
}

export const ToolsFromClient = async (
  client: Client,
  serverUrl: string,
): Promise<Tool[]> => {
  try {
    const toolsResult = await client.listTools();
    return toolsResult.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description || "",
        input_schema: tool.inputSchema,
      };
    });
  } catch (error) {
    console.error("Error fetching tools:", error);
    throw error;
  }
};
