import type { Tool } from "@anthropic-ai/sdk/src/resources/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import { MCPServer } from "../shared/mcpServer/server";

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
   * Query tools based on a search string
   * @param query The search query
   * @param limit Optional maximum number of results
   */
  public async queryTools(args: {
    query: string;
    limit?: number;
  }): Promise<Map<MCPServer, Tool[]>> {
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

    // The server returns JSON as a string in the text field
    try {
      const toolsData = JSON.parse(result.content[0].text);
      // Create a map with a single entry for the registry server
      const toolsMap = new Map<MCPServer, Tool[]>();

      // Create a proper MCPServer object
      const registryServer = new MCPServer("registry", "sse"); // only SSE servers for now.
      toolsMap.set(registryServer, toolsData);

      return toolsMap;
    } catch (error) {
      console.error("Error parsing queryTools result:", error);
      return new Map();
    }
  }

  /**
   * Add a new tool to the registry
   * @param tool The tool definition to add
   */
  public async addTool(tool: Tool): Promise<Tool> {
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

    // Extract the tool from the response
    const responseText = result.content[0].text;
    const match = responseText.match(/Tool added successfully:\n(.*)/s);
    if (match) {
      try {
        const addedTool = JSON.parse(match[1]);
        return addedTool;
      } catch (error) {
        console.error("Error parsing addTool result:", error);
      }
    }

    throw new Error(
      `Unexpected response format from add-tool: ${responseText}`,
    );
  }

  /**
   * Add all tools from an MCP server to the registry
   * @param serverUrl URL of the MCP server to add
   * @param type Type of server connection (stdio or sse)
   */
  public async addServer(
    serverUrl: string,
    type: "stdio" | "sse",
  ): Promise<Tool[]> {
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

    // Extract the added tools from the response
    const responseText = result.content[0].text;
    const match = responseText.match(/Added .* tools from server .*:\n(.*)/s);
    if (match) {
      try {
        const addedTools = JSON.parse(match[1]);
        return addedTools;
      } catch (error) {
        console.error("Error parsing addServer result:", error);
      }
    }

    throw new Error(
      `Unexpected response format from add-server: ${responseText}`,
    );
  }

  /**
   * List all tools in the registry
   */
  public async listTools(args: any = {}): Promise<{ tools: Tool[] }> {
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

    // Extract the tools from the response
    const responseText = result.content[0].text;
    const match = responseText.match(/Found .* tools:\n(.*)/s);
    if (match) {
      try {
        const tools = JSON.parse(match[1]);
        return { tools };
      } catch (error) {
        console.error("Error parsing listTools result:", error);
      }
    }

    // Handle the case where no tools are found
    if (responseText.includes("No tools found")) {
      return { tools: [] };
    }

    throw new Error(
      `Unexpected response format from list-tools: ${responseText}`,
    );
  }

  /**
   * Delete a tool from the registry
   * @param name The name of the tool to delete
   */
  public async deleteTool(name: string): Promise<boolean> {
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

    const responseText = result.content[0].text;
    const success = responseText.includes("deleted successfully");

    return success;
  }
}
