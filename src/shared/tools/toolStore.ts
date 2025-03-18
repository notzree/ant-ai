import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Connector, type ConnectionOptions } from "../connector/connector";
import { LRUCache } from "lru-cache";

import { MCPServer } from "../mcpServer/server";
// Define a type for tool handlers
export type ToolHandler = (
  toolName: string,
  toolArgs: any,
  result: any,
) => Promise<string | null>;

// Define a type for tool execution result
export interface ToolExecutionResult {
  rawResult: any;
  callbackResult: string | null;
}

// Store server information for a tool
interface ToolServerInfo {
  serverUrl: string;
  serverType: "sse" | "stdio";
  authToken?: string;
  clientIndex?: number; // Optional - will be set when client is connected
}

// Default handler that just passes through the result
export const defaultToolHandler: ToolHandler = async () => null;

export class ToolStore {
  // Maps from tool name -> custom handler
  private toolHandlers = new Map<string, ToolHandler>();

  // All available tools (including those without connected clients)
  private availableTools: Tool[] = [];

  // Maps from tool name -> server info (for lazy connection)
  private toolServerInfo = new Map<string, ToolServerInfo>();

  // The connector used to create client connections
  private connector: Connector;

  private clientCache: LRUCache<string, Client>;

  // App name and version for connections
  private appName: string;
  private appVersion: string;

  constructor(
    connector?: Connector,
    appName = "ant",
    appVersion = "1.0.0",
    maxConnections = 10,
  ) {
    this.connector = connector || new Connector();
    this.appName = appName;
    this.appVersion = appVersion;

    this.clientCache = new LRUCache({
      max: maxConnections,
      dispose: async (value, key) => {
        try {
          await value.close();
          console.log(`Closed connection to ${key} due to cache eviction`);
        } catch (error) {
          console.error(`Error closing connection to ${key}:`, error);
        }
      },
      ttl: 30 * 60 * 1000,
    });
  }

  /**
   * Get all available tools
   */
  getAvailableTools(): Tool[] {
    return [...this.availableTools];
  }

  /**
   * Register a custom handler for a specific tool
   */
  registerToolHandler(toolName: string, handler: ToolHandler): void {
    this.toolHandlers.set(toolName, handler);
    console.log(`Registered custom handler for tool: ${toolName}`);
  }

  /**
   * Add multiple tool handlers at once
   */
  registerToolHandlers(handlers: Map<string, ToolHandler>): void {
    for (const [toolName, handler] of handlers.entries()) {
      this.registerToolHandler(toolName, handler);
    }
  }

  /**
   * Get the handler for a specified tool
   */
  private getToolHandler(toolName: string): ToolHandler {
    return this.toolHandlers.get(toolName) || defaultToolHandler;
  }

  /**
   * Connect to an MCP server and register its tools immediately
   */
  async connectToServer(
    opts: ConnectionOptions,
    toolHandlers?: Map<string, ToolHandler>,
  ): Promise<Tool[]> {
    try {
      // Use cache key for consistency with ensureClientConnection
      const cacheKey = `${opts.url}::${opts.type}`;

      // Check if we already have a client for this server
      let client = this.clientCache.get(cacheKey);

      if (!client) {
        client = await this.connector.connect(opts);
        this.clientCache.set(cacheKey, client);
      }

      const toolsResult = await client.listTools();

      // Add new tools to available tools
      const newTools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));

      for (const tool of newTools) {
        // Store server info for these tools
        this.toolServerInfo.set(tool.name, {
          serverUrl: opts.url,
          serverType: opts.type,
          authToken: opts.authToken,
        });
      }

      this.availableTools = [...this.availableTools, ...newTools];

      console.log(
        `Connected to server ${opts.url} with tools:`,
        newTools.map(({ name }) => name),
      );

      if (toolHandlers) {
        this.registerToolHandlers(toolHandlers);
      }

      return newTools;
    } catch (e) {
      console.log(`Failed to connect to MCP server ${opts.url}: `, e);
      throw e;
    }
  }

  /**
   * Register tools without immediately connecting to their servers
   * @param serverToolsMap Map of MCP servers to their tools
   * @param toolHandlers Optional map of tool handlers
   */
  registerTools(
    serverToolsMap: Map<MCPServer, Tool[]>,
    toolHandlers?: Map<string, ToolHandler>,
  ): Tool[] {
    const newTools: Tool[] = [];

    // Process each server and its tools
    for (const [server, tools] of serverToolsMap.entries()) {
      for (const tool of tools) {
        // Create the Anthropic tool format

        // Add to available tools
        this.availableTools.push(tool);
        newTools.push(tool);

        // Store server info for lazy connection
        this.toolServerInfo.set(tool.name, {
          serverUrl: server.url,
          serverType: server.type,
          authToken: server.authToken,
        });
      }
    }

    // Register any custom handlers
    if (toolHandlers) {
      this.registerToolHandlers(toolHandlers);
    }

    console.log(`Registered ${newTools.length} tools for lazy initialization`);
    return newTools;
  }

  /**
   * Lazy-initialize a client connection for a tool
   * @param toolName The name of the tool
   */
  private async ensureClientConnection(toolName: string): Promise<Client> {
    // Get server info for this tool
    const serverInfo = this.toolServerInfo.get(toolName);
    if (!serverInfo) {
      throw new Error(`No server information for tool: ${toolName}`);
    }

    // Create a cache key for this server
    const cacheKey = `${serverInfo.serverUrl}::${serverInfo.serverType}`;

    // Check if we have a cached client
    let client = this.clientCache.get(cacheKey);

    // If no cached client, create a new connection
    if (!client) {
      console.log(`Lazily connecting to server for tool: ${toolName}`);

      const opts: ConnectionOptions = {
        url: serverInfo.serverUrl,
        type: serverInfo.serverType,
        authToken: serverInfo.authToken,
        appName: this.appName,
        appVersion: this.appVersion,
      };

      client = await this.connector.connect(opts);

      // Store in cache
      this.clientCache.set(cacheKey, client);
      console.log(`Connected to server for tool: ${toolName}`);
    }

    // Update access time in cache (the LRU cache does this automatically)
    return client;
  }

  /**
   * Execute a tool by name with given arguments
   * Lazily connects to the server if needed
   */
  async executeTool(
    toolName: string,
    toolArgs: any,
  ): Promise<ToolExecutionResult> {
    try {
      // Get a client for this tool (may create a new connection or reuse existing)
      const client = await this.ensureClientConnection(toolName);

      // Call the tool
      const result = await client.callTool({
        name: toolName,
        arguments: toolArgs,
      });

      if (result === undefined) {
        throw new Error(`Client failed to handle tool ${toolName}`);
      }

      // Handle result with custom handlers as before
      const handler = this.getToolHandler(toolName);
      const processedResult = await handler(toolName, toolArgs, result.content);

      return {
        rawResult: result.content,
        callbackResult: processedResult,
      };
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Clean up all client connections
   */
  async cleanup(): Promise<void> {
    this.clientCache.clear();
  }
}
