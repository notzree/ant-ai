import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@anthropic-ai/sdk/resources/index.mjs";

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
