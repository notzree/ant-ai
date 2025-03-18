import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { AntTool } from "../shared/tools/tool.js";
import type { MCPServer } from "../shared/mcpServer/server.js";

/**
 * Registry interface for managing AI assistant tools
 */
export interface Registry {
  /**
   * Query tools in the registry based on relevance to a search query
   *
   * @param query - The search query to match against tools
   * @param limit - Maximum number of results to return (default: 5)
   * @returns Promise resolving to an array of mcp servers to connect to.
   */
  queryTools(query: string, limit?: number): Promise<MCPServer[]>;

  /**
   * Add a tool to the registry
   *
   * @param tool - The tool to add to the registry
   * @returns Promise resolving to the added tool
   */
  addTool(tool: AntTool): Promise<AntTool>;

  /**
   * Add all tools from an MCP server to the registry
   *
   * @param serverUrl - URL of the MCP server
   * @param type - Type of connection to the server ("stdio" or "sse")
   * @returns Promise resolving to an array of added tools
   */
  addServer(serverUrl: string, type: "stdio" | "sse"): Promise<AntTool[]>;

  /**
   * List all tools in the registry
   *
   * @returns Promise resolving to an array of all tools
   */
  listTools(): Promise<AntTool[]>;

  /**
   * Delete a tool from the registry
   *
   * @param name - The ID/name of the tool to delete
   * @returns Promise resolving to a boolean indicating success
   */
  deleteTool(name: string): Promise<boolean>;

  /**
   * Optional: Initialize the registry if needed
   *
   * @returns Promise that resolves when initialization is complete
   */
  initialize?(): Promise<void>;
}
