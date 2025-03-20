import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import {
  Connector,
  type ConnectionOptions,
} from "../../shared/connector/connector";
import { LRUCache } from "lru-cache";
import { TextBlock, ToolResultBlock } from "../../shared/messages/messages";
import type { RegistryClient } from "../../registry/registryClient";
import type { ToolWithServerInfo } from "../../shared/tools/tool";
import type { ToolUseBlock } from "../../shared/messages/messages";

export type UntypedMCPArgs =
  | {
      [x: string]: unknown;
    }
  | undefined;

// Store server information for a tool
interface ToolServerInfo {
  serverUrl: string;
  serverType: "sse" | "stdio";
  authToken?: string;
  clientIndex?: number; // Optional - will be set when client is connected
}

// Default handler that just passes through the result

export class ToolStore {
  private rc: RegistryClient;

  // All available tools (including those without connected clients)
  // private availableTools: Tool[] = [];
  private availableTools: Map<string, MCPTool> = new Map();

  // Maps from tool name -> server info (for lazy connection)
  private toolServerInfo = new Map<string, ToolServerInfo>();

  // The connector used to create client connections
  private connector: Connector;

  private clientCache: LRUCache<string, Client>;

  // App name and version for connections
  private appName: string;
  private appVersion: string;

  constructor(
    registryClient: RegistryClient,
    connector?: Connector,
    appName = "ant",
    appVersion = "1.0.0",
    maxConnections = 10,
  ) {
    this.connector = connector || new Connector();
    this.appName = appName;
    this.appVersion = appVersion;
    this.rc = registryClient;

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
  getAvailableTools(): MCPTool[] {
    return [...this.availableTools.values(), ...this.rc.registryTools];
  }

  /**
   * Connect to an MCP server and register its tools immediately
   */
  async connectToServer(opts: ConnectionOptions): Promise<MCPTool[]> {
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
        inputSchema: tool.inputSchema,
      }));

      // Check for conflicts before adding any tools
      // WARNING: not 100% sure if MCP guarantees unique tool names across servers.
      // may need to implement some sorta severname + toolname thing down the line.
      const conflicts: Array<{
        toolName: string;
        existingServer: string;
        newServer: string;
      }> = [];

      for (const tool of newTools) {
        // Check if this tool name already exists and comes from a different server
        if (this.toolServerInfo.has(tool.name)) {
          const existingServerInfo = this.toolServerInfo.get(tool.name);

          if (existingServerInfo && existingServerInfo.serverUrl !== opts.url) {
            conflicts.push({
              toolName: tool.name,
              existingServer: existingServerInfo.serverUrl,
              newServer: opts.url,
            });
          }
        }
      }

      // If there are conflicts, throw a detailed error
      if (conflicts.length > 0) {
        const conflictDetails = conflicts
          .map(
            (c) =>
              `Tool "${c.toolName}" already exists from server "${c.existingServer}"`,
          )
          .join("\n");

        throw new Error(
          `Tool name conflicts detected when connecting to ${opts.url}:\n${conflictDetails}\n` +
            `Tools must have unique names across all servers.`,
        );
      }

      // No conflicts, safe to register the tools
      for (const tool of newTools) {
        // Store server info for these tools
        this.toolServerInfo.set(tool.name, {
          serverUrl: opts.url,
          serverType: opts.type,
          authToken: opts.authToken,
        });
        this.availableTools.set(tool.name, tool);
      }

      console.log(
        `Connected to server ${opts.url} with tools:`,
        newTools.map(({ name }) => name),
      );

      return newTools;
    } catch (e) {
      console.log(`Failed to connect to MCP server ${opts.url}: `, e);
      throw e;
    }
  }
  /**
   * Register tools without immediately connecting to their servers
   * @param toolsWithServerInfo Array of tools with their server information
   * @returns Array of registered tools
   */
  registerTools(toolsWithServerInfo: ToolWithServerInfo[]): MCPTool[] {
    const newTools: MCPTool[] = [];

    // Process each tool with its server info
    for (const { tool, server } of toolsWithServerInfo) {
      // Add to available tools
      this.availableTools.set(tool.name, tool);
      newTools.push(tool);

      // Store server info for lazy connection
      this.toolServerInfo.set(tool.name, {
        serverUrl: server.url,
        serverType: server.type,
        authToken: server.authToken,
      });
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
  async executeTool(block: ToolUseBlock): Promise<ToolResultBlock> {
    const toolUseId = block.id;
    const toolName = block.name;
    const toolArgs = block.args as { [x: string]: unknown } | undefined;

    if (this.rc.Tools().has(toolName)) {
      try {
        // Handle special registry tools that we need to process
        // we need to convert each of the complex objects back into JSON strings
        // so the llm can understand them.
        // also TODO: figure out if there is a better way to maintain this
        // since we would need to update this huge if statement chain, the registryClient, the mcpServer, and the registry each time we make a change.
        if (toolName === "query-tools") {
          const result = await this.rc.queryTools(toolArgs);
          this.registerTools(result.result);
          // Temporary fix right here to reduce the amount of context for each prompt.
          // may need to fix the rawResult ot actually just be a description of what happened, as the actual tool data is already being passed
          // to the LLM create message function so this is unecessary.
          const toolNames = result.result
            .map((tool) => tool.tool.name)
            .join(", ");
          return new ToolResultBlock(
            toolUseId,
            [
              new TextBlock(
                `successfully queried and added ${toolNames}`,
                false,
              ),
            ],
            false,
            false,
          );
        } else if (toolName === "list-tools") {
          const result = await this.rc.listTools(toolArgs);
          return new ToolResultBlock(
            toolUseId,
            [new TextBlock(result.rawResult, false)],
            false,
            false,
          );
        } else if (toolName === "add-tool") {
          const result = await this.rc.addTool(toolArgs);
          return new ToolResultBlock(
            toolUseId,
            [new TextBlock(result.rawResult, false)],
            false,
            false,
          );
        } else if (toolName === "add-server") {
          const result = await this.rc.addServer(toolArgs);
          return new ToolResultBlock(
            toolUseId,
            [new TextBlock(result.rawResult, false)],
            false,
            false,
          );
        } else if (toolName === "delete-tool") {
          const result = await this.rc.deleteTool(toolArgs);
          return new ToolResultBlock(
            toolUseId,
            [new TextBlock(result.rawResult, false)],
            false,
            false,
          );
        } else {
          //TODO: do we throw here or return a result block with an error message?
          throw new Error(`Unsupported registry tool ${toolName}`);
        }
      } catch (error) {
        console.error(`Error executing registry tool ${toolName}:`, error);
        throw error;
      }
    } else {
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

        return new ToolResultBlock(
          toolUseId,
          [new TextBlock(result, false, result._meta)],
          false,
          result.isError ? true : false, //this might be wrong
        );
      } catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        throw error;
      }
    }
  }

  /**
   * Clean up all client connections
   */
  async cleanup(): Promise<void> {
    this.clientCache.clear();
  }
}
