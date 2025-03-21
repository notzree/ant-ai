import type { Registry } from "./registry";
import { ToolsFromClient, type ToolWithServerInfo } from "../shared/tools/tool";
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/src/resources/index.js";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import { MCPServer } from "../shared/mcpServer/server";
export class inMemoryRegistry implements Registry {
  private vectorStore: MemoryVectorStore | null = null;
  private embeddings: OpenAIEmbeddings;
  private tools: Map<string, ToolWithServerInfo> = new Map();
  private servers: Map<string, MCPServer> = new Map(); // Map of server IDs to server objects

  constructor() {
    this.embeddings = new OpenAIEmbeddings();
  }

  /**
   * Initialize the vector store
   */
  public async initialize(): Promise<void> {
    if (!this.vectorStore) {
      this.vectorStore = await MemoryVectorStore.fromDocuments(
        [],
        this.embeddings,
      );
    }
  }

  /**
   * Add multiple servers and their tools concurrently from string format
   * @param serverStrings - Array of server strings in format "url::type" where type is 'sse' or 'stdio'
   * @param authTokens - Optional map of server URLs to their authentication tokens
   * @returns Map of server IDs to their added tools
   */
  public async addServersConcurrently(
    serverStrings: string[],
    authTokens?: Map<string, string>,
  ): Promise<Map<string, MCPTool[]>> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }

    // Parse server strings into config objects
    const serverConfigs = serverStrings.map((serverString) => {
      const [serverUrl, type] = serverString.split("::");

      if (!serverUrl || !type) {
        throw new Error(
          `Invalid server string format: ${serverString}. Expected format: "url::type"`,
        );
      }

      if (type !== "sse" && type !== "stdio") {
        throw new Error(
          `Invalid server type: ${type}. Expected 'sse' or 'stdio'`,
        );
      }

      // Get the auth token for this specific server URL if it exists
      const authToken = authTokens?.get(serverUrl);

      return {
        serverUrl,
        type: type as "stdio" | "sse",
        authToken,
      };
    });

    const results = new Map<string, MCPTool[]>();

    // Create promises for each server addition
    const serverPromises = serverConfigs.map(async (config) => {
      const { serverUrl, type, authToken } = config;

      // Create server object
      const server = new MCPServer(serverUrl, type, authToken);
      const serverId = server.getId();
      this.servers.set(serverId, server);

      const connector = new Connector();
      const opts: ConnectionOptions = {
        type: type,
        url: serverUrl,
        appName: "ant",
        appVersion: "1.0.0",
        authToken: authToken,
      };

      try {
        const client = await connector.connect(opts);
        const tools = await ToolsFromClient(client, serverUrl);

        // Create promises for each tool addition
        const toolsArray = new Array(tools.length);
        const toolPromises = tools.map(async (tool, index) => {
          toolsArray[index] = await this.addTool(tool, server);
        });

        // Wait for all tools to be added
        await Promise.all(toolPromises);

        // Store the result
        results.set(serverId, toolsArray);
        return { serverId, tools: toolsArray };
      } catch (error) {
        console.error(
          `Failed to connect to server ${serverUrl}: ${error.message}`,
        );
        // Still add the server to the results with an empty tools array
        results.set(serverId, []);
        return { serverId, tools: [] };
      }
    });

    // Wait for all servers to be added concurrently
    await Promise.all(serverPromises);

    return results;
  }

  /**
   * Add a server and all its tools using string format
   * @param serverString - Server string in format "url::type" where type is 'sse' or 'stdio'
   * @param authToken - Optional authentication token
   * @returns Array of added tools
   */
  public async addServer(
    serverString: string,
    authToken?: string,
  ): Promise<MCPTool[]> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }

    // Parse server string
    const [serverUrl, type] = serverString.split("::");

    if (!serverUrl || !type) {
      throw new Error(
        `Invalid server string format: ${serverString}. Expected format: "url::type"`,
      );
    }

    if (type !== "sse" && type !== "stdio") {
      throw new Error(
        `Invalid server type: ${type}. Expected 'sse' or 'stdio'`,
      );
    }

    // Create server object
    const server = new MCPServer(serverUrl, type as "stdio" | "sse", authToken);
    const serverId = server.getId();
    this.servers.set(serverId, server);

    const connector = new Connector();
    const opts: ConnectionOptions = {
      type: type as "stdio" | "sse",
      url: serverUrl,
      appName: "ant",
      appVersion: "1.0.0",
      authToken: authToken,
    };

    const client = await connector.connect(opts);
    const tools = await ToolsFromClient(client, serverUrl);
    const result = new Array(tools.length);
    const promises = tools.map(async (tool, index) => {
      result[index] = await this.addTool(tool, server);
    });
    await Promise.all(promises);
    return result;
  }

  /**
   * Add a tool with its associated server
   * @param tool - The tool to add
   * @param server - The MCPServer the tool belongs to
   * @returns The added tool
   */
  public async addTool(tool: MCPTool, server: MCPServer): Promise<MCPTool> {
    if (!this.vectorStore) {
      await this.initialize();
    }

    // Create the tool with server info
    const toolWithServer: ToolWithServerInfo = {
      tool: tool,
      server: server,
    };

    // Store the tool in our Map for quick retrieval
    this.tools.set(tool.name, toolWithServer);

    // Make sure the server is stored
    this.servers.set(server.getId(), server);

    // Create a document for the vector store
    const document = new Document({
      pageContent: `${tool.name}: ${tool.description}`,
      metadata: {
        name: tool.name,
        serverId: server.getId(),
        toolData: JSON.stringify(tool), // Store the full tool data as JSON
      },
    });

    // Add to vector store
    await this.vectorStore!.addDocuments([document]);
    return tool;
  }

  /**
   * Delete a tool by name
   * @param name - The name of the tool to delete
   * @returns boolean indicating success
   */
  public async deleteTool(name: string): Promise<boolean> {
    if (!this.vectorStore || !this.tools.has(name)) {
      return false;
    }

    // Remove from our tools Map
    const toolInfo = this.tools.get(name);
    this.tools.delete(name);

    // For in-memory vector store, we need to recreate it without the deleted document
    // since MemoryVectorStore doesn't support direct deletion
    const remainingTools = Array.from(this.tools.values());

    // Recreate the vector store
    this.vectorStore = await MemoryVectorStore.fromDocuments(
      remainingTools.map(
        (toolInfo) =>
          new Document({
            pageContent: `${toolInfo.tool.name}: ${toolInfo.tool.description}`,
            metadata: {
              name: toolInfo.tool.name,
              serverId: toolInfo.server.getId(),
              toolData: JSON.stringify(toolInfo.tool),
            },
          }),
      ),
      this.embeddings,
    );

    return true;
  }

  /**
   * Search for tools based on a query string
   * @param query - The search query
   * @param limit - The maximum number of results to return (default: 5)
   * @returns Array of ToolWithServerInfo for relevant tools
   */
  public async queryTools(
    query: string,
    limit?: number,
  ): Promise<ToolWithServerInfo[]> {
    if (!this.vectorStore) {
      await this.initialize();
      return []; // Return empty array
    }
    if (!limit) {
      // Default limit
      limit = 10;
    }

    // Perform similarity search
    const results = await this.vectorStore.similaritySearch(
      query + "\n Additionally, any relevant connection tools",
      limit,
    );
    const tools: ToolWithServerInfo[] = results
      .map((doc) => {
        try {
          const serverId = doc.metadata.serverId as string;
          const mcpServer = this.servers.get(serverId);
          if (!mcpServer) {
            console.error(`Server with ID ${serverId} not found`);
            return null;
          }
          const tool = JSON.parse(doc.metadata.toolData as string) as MCPTool;
          return {
            tool: tool,
            server: mcpServer,
          };
        } catch (e) {
          console.error(`Error parsing tool data for ${doc.metadata.name}:`, e);
          return null;
        }
      })
      .filter((item): item is ToolWithServerInfo => item !== null);

    return tools;
  }

  /**
   * Get all tools
   * @returns Array of all tools
   */
  public async listTools(): Promise<MCPTool[]> {
    return Promise.resolve(
      Array.from(this.tools.values()).map((toolInfo) => toolInfo.tool),
    );
  }

  /**
   * Get all servers
   * @returns Array of all servers
   */
  public async listServers(): Promise<MCPServer[]> {
    return Promise.resolve(Array.from(this.servers.values()));
  }

  /**
   * Get all tools grouped by server
   * @returns Map of server to tools
   */
  public async getToolsByServer(): Promise<Map<MCPServer, MCPTool[]>> {
    const serverMap = new Map<MCPServer, MCPTool[]>();

    // Initialize empty arrays for each server
    for (const server of this.servers.values()) {
      serverMap.set(server, []);
    }

    // Add tools to their respective servers
    for (const toolInfo of this.tools.values()) {
      const { tool, server } = toolInfo;

      // Find the matching server in our map
      for (const [mapServer, tools] of serverMap.entries()) {
        if (server.equals(mapServer)) {
          tools.push(tool);
          break;
        }
      }
    }

    return serverMap;
  }
}
