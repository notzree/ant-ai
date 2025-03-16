import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export class AntTool {
  serverUrl: string;
  name: string;
  description: string;
  inputSchema: object;

  constructor(
    serverUrl: string,
    name: string,
    description: string,
    inputSchema: object,
  ) {
    this.serverUrl = serverUrl;
    this.name = name;
    this.description = description;
    this.inputSchema = inputSchema;
  }

  static async FromClient(
    client: Client,
    serverUrl: string,
  ): Promise<AntTool[]> {
    try {
      const toolsResult = await client.listTools();
      const tools: AntTool[] = toolsResult.tools.map((tool) => {
        return new AntTool(
          serverUrl,
          tool.name,
          tool.description || "",
          tool.inputSchema,
        );
      });
      return tools;
    } catch (error) {
      console.error("Error fetching tools:", error);
      throw error;
    }
  }
}
