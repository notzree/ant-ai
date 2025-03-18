import type { Registry } from "./registry";
import { ToolsFromClient } from "../shared/tools/tool";
import type { Tool } from "@anthropic-ai/sdk/src/resources/index.js";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import { MCPServer } from "../shared/mcpServer/server";

// Extended Tool interface to include server information in metadata
interface ToolWithServerInfo {
  tool: Tool;
  server: MCPServer;
}

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
   * Add a server and all its tools
   * @param serverUrl - URL of the server to add
   * @param type - Type of server connection (stdio or sse)
   * @param authToken - Optional authentication token
   * @returns Array of added tools
   */
  public async addServer(
    serverUrl: string,
    type: "stdio" | "sse",
    authToken?: string,
  ): Promise<Tool[]> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }

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
  public async addTool(tool: Tool, server: MCPServer): Promise<Tool> {
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
   * @returns Map of MCPServer to Tool[] for relevant tools
   */
  public async queryTools(
    query: string,
    limit?: number,
  ): Promise<Map<MCPServer, Tool[]>> {
    if (!this.vectorStore) {
      await this.initialize();
      return new Map(); // Return empty map
    }

    if (!limit) {
      // Default limit
      limit = 5;
    }

    // Perform similarity search
    const results = await this.vectorStore.similaritySearch(query, limit);

    // Group results by server
    const serverToolsMap = new Map<string, Tool[]>();

    for (const doc of results) {
      try {
        const serverId = doc.metadata.serverId as string;
        const tool = JSON.parse(doc.metadata.toolData as string) as Tool;

        if (!serverToolsMap.has(serverId)) {
          serverToolsMap.set(serverId, []);
        }

        serverToolsMap.get(serverId)!.push(tool);
      } catch (e) {
        console.error(`Error parsing tool data for ${doc.metadata.name}:`, e);
      }
    }

    // Convert to the required Map<MCPServer, Tool[]> format
    const resultMap = new Map<MCPServer, Tool[]>();

    for (const [serverId, tools] of serverToolsMap.entries()) {
      const server = this.servers.get(serverId);
      if (server) {
        resultMap.set(server, tools);
      } else {
        console.error(`Server with ID ${serverId} not found`);
      }
    }

    return resultMap;
  }

  /**
   * Get all tools
   * @returns Array of all tools
   */
  public async listTools(): Promise<Tool[]> {
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
  public async getToolsByServer(): Promise<Map<MCPServer, Tool[]>> {
    const serverMap = new Map<MCPServer, Tool[]>();

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
