import type { Tool } from "@anthropic-ai/sdk/src/resources/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import { MCPServer } from "../shared/mcpServer/server";
import type { ToolWithServerInfo } from "../shared/tools/tool";

/**
 * A generic type that wraps a result type with its raw JSON representation
 */
export type WithRawResult<T> = {
  result: T;
  rawResult: string;
};

export class RegistryClient {
  private connector: Connector = new Connector();
  private registry: Client | null = null;
  public registryTools: Tool[] = [];

  /**
   * Initialize the registry client by connecting to the registry server
   * and fetching the available tools
   */
  public async initialize(registryOpts: ConnectionOptions) {
    this.registry = await this.connector.connect(registryOpts);
    await this.refreshToolsList();
    console.log("---TOOLS---");
    console.log(this.Tools());
  }

  /**
   * Refresh the list of available tools from the registry
   */
  private async refreshToolsList(): Promise<void> {
    if (!this.registry) {
      throw new Error("Registry client not initialized");
    }

    const toolsResult = await this.registry.listTools();
    // Add new tools to available tools
    const convertedTools = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    this.registryTools = convertedTools;
  }

  /**
   * Get the set of tool names available in the registry
   */
  public Tools(): Set<string> {
    const coveredTools: Set<string> = new Set();
    for (const tool of this.registryTools) {
      coveredTools.add(tool.name);
    }
    return coveredTools;
  }

  /**
   * Execute a tool on the registry server
   * @param toolName The name of the tool to execute
   * @param args The arguments to pass to the tool
   TODO: Do we even need this? This fcks up the typing
   */
  public async executeTool(toolName: string, args: any): Promise<any> {
    if (!this.registry) {
      throw new Error("Registry client not initialized");
    }

    // Check if the tool exists in the registry
    if (!this.Tools().has(toolName)) {
      throw new Error(`Tool '${toolName}' not found in registry`);
    }

    const result = await this.registry.callTool({
      name: toolName,
      arguments: args,
    });

    if (!result) {
      throw new Error(
        `Failed to execute tool ${toolName} with args: ${JSON.stringify(args)}`,
      );
    }

    return result;
  }

  /**
   * Find the JSON content from response
   * @private
   */
  private getJsonContent(result: any): string {
    // Find the content item marked as JSON
    const jsonItem = result.content.find(
      (item: any) => item.type === "text" && item.isJson === true,
    );

    if (!jsonItem) {
      throw new Error("Response does not contain JSON data");
    }

    return jsonItem.text;
  }

  /**
   * Query tools based on a search string
   * @param query The search query
   * @param limit Optional maximum number of results
   */
  public async queryTools(args: {
    query: string;
    limit?: number;
  }): Promise<WithRawResult<ToolWithServerInfo[]>> {
    if (!this.registry) {
      throw new Error("Registry client not initialized");
    }
    const result = await this.registry.callTool({
      name: "query-tools",
      arguments: args,
    });
    if (result === undefined) {
      throw new Error(
        `Registry failed to queryTools with args: ${JSON.stringify(args)}`,
      );
    }

    try {
      // Get the JSON content
      const rawResult = this.getJsonContent(result);

      // Parse the JSON string to an array of ToolWithServerInfo
      const parsedData = JSON.parse(rawResult) as Array<ToolWithServerInfo>;

      // Convert each plain object to proper ToolWithServerInfo with MCPServer instances
      const tools = parsedData.map((item) => ({
        tool: item.tool,
        server: new MCPServer(
          item.server.url,
          item.server.type,
          item.server.authToken,
        ),
      }));

      return {
        result: tools,
        rawResult,
      };
    } catch (error) {
      console.error("Error parsing queryTools result:", error);
      return {
        result: [],
        rawResult: "[]",
      };
    }
  }

  /**
   * Add a new tool to the registry
   * @param tool The tool definition to add
   */
  public async addTool(tool: Tool): Promise<WithRawResult<Tool>> {
    if (!this.registry) {
      throw new Error("Registry client not initialized");
    }

    const result = await this.registry.callTool({
      name: "add-tool",
      arguments: { tool },
    });

    if (!result) {
      throw new Error(`Failed to add tool: ${JSON.stringify(tool)}`);
    }

    try {
      // Get the JSON content
      const rawResult = this.getJsonContent(result);

      // Parse the JSON string
      const addedTool = JSON.parse(rawResult);

      return {
        result: addedTool,
        rawResult,
      };
    } catch (error) {
      console.error("Error parsing addTool result:", error);
      throw new Error(`Failed to parse add-tool response: ${error}`);
    }
  }

  /**
   * Add all tools from an MCP server to the registry
   * @param serverUrl URL of the MCP server to add
   * @param type Type of server connection (stdio or sse)
   */
  public async addServer(
    serverUrl: string,
    type: "stdio" | "sse",
  ): Promise<WithRawResult<Tool[]>> {
    if (!this.registry) {
      throw new Error("Registry client not initialized");
    }

    const result = await this.registry.callTool({
      name: "add-server",
      arguments: { serverUrl, type },
    });

    if (!result) {
      throw new Error(`Failed to add server: ${serverUrl}`);
    }

    try {
      // Get the JSON content
      const rawResult = this.getJsonContent(result);

      // Parse the JSON string
      const addedTools = JSON.parse(rawResult);

      return {
        result: addedTools,
        rawResult,
      };
    } catch (error) {
      console.error("Error parsing addServer result:", error);
      throw new Error(`Failed to parse add-server response: ${error}`);
    }
  }

  /**
   * List all tools in the registry
   */
  public async listTools(
    args: any = {},
  ): Promise<WithRawResult<{ tools: Tool[] }>> {
    if (!this.registry) {
      throw new Error("Registry client not initialized");
    }

    const result = await this.registry.callTool({
      name: "list-tools",
      arguments: args,
    });

    if (!result) {
      throw new Error("Failed to list tools");
    }

    try {
      // Get the JSON content
      const rawResult = this.getJsonContent(result);

      // Parse the JSON string
      const tools = JSON.parse(rawResult);

      return {
        result: { tools },
        rawResult,
      };
    } catch (error) {
      console.error("Error parsing listTools result:", error);
      return {
        result: { tools: [] },
        rawResult: "[]",
      };
    }
  }

  /**
   * Delete a tool from the registry
   * @param name The name of the tool to delete
   */
  public async deleteTool(name: string): Promise<WithRawResult<boolean>> {
    if (!this.registry) {
      throw new Error("Registry client not initialized");
    }

    const result = await this.registry.callTool({
      name: "delete-tool",
      arguments: { name },
    });

    if (!result) {
      throw new Error(`Failed to delete tool: ${name}`);
    }

    try {
      // Get the JSON content
      const rawResult = this.getJsonContent(result);

      // Parse the JSON string
      const success = JSON.parse(rawResult);

      return {
        result: success,
        rawResult,
      };
    } catch (error) {
      console.error("Error parsing deleteTool result:", error);
      throw new Error(`Failed to parse delete-tool response: ${error}`);
    }
  }
}
