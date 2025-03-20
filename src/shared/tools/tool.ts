import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { type Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index.mjs";
import { MCPServer } from "../mcpServer/server";
// Extended Tool interface to include server information in metadata
export interface ToolWithServerInfo {
  tool: MCPTool;
  server: MCPServer;
}

export const ToolsFromClient = async (
  client: Client,
  serverUrl: string,
): Promise<MCPTool[]> => {
  try {
    const toolsResult = await client.listTools();
    return toolsResult.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    });
  } catch (error) {
    console.error("Error fetching tools:", error);
    throw error;
  }
};

export const toAnthropic = (tools: MCPTool | MCPTool[]): AnthropicTool[] => {
  if (Array.isArray(tools)) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  } else {
    return [
      {
        name: tools.name,
        description: tools.description,
        input_schema: tools.inputSchema,
      },
    ];
  }
};
