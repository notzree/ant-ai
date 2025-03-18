import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Registry } from "./registry.js";
// import { AntTool } from "../shared/tools/tool.js";
import type { Tool } from "@anthropic-ai/sdk/resources/index.mjs";
import { inMemoryRegistry } from "./inMemoryRegistry.js";

/**
 * MCP Server that exposes Registry API operations
 * Allows LLMs to query for tools, add tools, list tools, and delete tools
 */
export class RegistryMcpServer {
  private server: McpServer;
  private registry: Registry;

  /**
   * Create a new Registry MCP Server
   * @param registry The registry implementation to use
   * @param name The name of the server
   * @param version The version of the server
   */
  constructor(
    registry: Registry,
    name: string = "registry",
    version: string = "1.0.0",
  ) {
    this.registry = registry;
    this.server = new McpServer({
      name,
      version,
    });

    this.registerTools();
  }

  /**
   * Register all registry API tools with the MCP server
   */
  private registerTools(): void {
    // Tool: Query tools in the registry
    this.server.tool(
      "query-tools",
      "Search for tools based on a query string",
      {
        query: z.string().describe("The search query"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default: 5)"),
      },
      async ({ query, limit }) => {
        try {
          const tools = await this.registry.queryTools(query, limit);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(tools, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error("Error querying tools:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error querying tools: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );

    // Tool: Add a tool to the registry
    this.server.tool(
      "add-tool",
      "Add a new tool to the registry",
      {
        tool: z
          .object({
            name: z.string().describe("Name of the tool"),
            description: z.string().describe("Description of the tool"),
            input_schema: z
              .object({
                type: z
                  .literal("object")
                  .describe(
                    "Must be 'object' for Anthropic Tool compatibility",
                  ),
                properties: z
                  .record(z.any())
                  .optional()
                  .describe("Properties of the input schema"),
                required: z
                  .array(z.string())
                  .optional()
                  .describe("Required properties"),
              })
              .passthrough()
              .describe("Schema defining the input parameters for the tool"),
          })
          .describe("The tool to add"),
      },
      async ({ tool }) => {
        try {
          const addedTool = await this.registry.addTool(tool);
          return {
            content: [
              {
                type: "text",
                text: `Tool added successfully:\n${JSON.stringify(addedTool, null, 2)}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error adding tool:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error adding tool: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );

    // Tool: Add a server to the registry
    this.server.tool(
      "add-server",
      "Add all tools from an MCP server to the registry",
      {
        serverUrl: z.string().describe("URL of the MCP server to add"),
        type: z
          .enum(["stdio", "sse"])
          .describe("Type of the server connection (stdio or sse)"),
      },
      async ({ serverUrl, type }) => {
        try {
          const addedTools = await this.registry.addServer(serverUrl, type);
          return {
            content: [
              {
                type: "text",
                text: `Added ${addedTools.length} tools from server ${serverUrl}:\n${JSON.stringify(addedTools, null, 2)}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error adding server:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error adding server: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );

    // Tool: List all tools in the registry
    this.server.tool(
      "list-tools",
      "List all tools in the registry",
      {},
      async () => {
        try {
          const tools = await this.registry.listTools();
          // console.log(`{${JSON.stringify(tools, null, 2)}}`);
          return {
            content: [
              {
                type: "text",
                text:
                  tools.length > 0
                    ? `Found ${tools.length} tools:\n${JSON.stringify(tools, null, 2)}`
                    : "No tools found in the registry.",
              },
            ],
          };
        } catch (error) {
          console.error("Error listing tools:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error listing tools: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );

    // Tool: Delete a tool from the registry
    this.server.tool(
      "delete-tool",
      "Delete a tool from the registry",
      {
        name: z.string().describe("The ID of the tool to delete"),
      },
      async ({ name }) => {
        try {
          const success = await this.registry.deleteTool(name);
          return {
            content: [
              {
                type: "text",
                text: success
                  ? `Tool '${name}' deleted successfully.`
                  : `Tool '${name}' not found or could not be deleted.`,
              },
            ],
          };
        } catch (error) {
          console.error("Error deleting tool:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error deleting tool: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );
  }

  /**
   * Connect the server to a transport and start listening for requests
   * @param transport The transport to use for connecting to the MCP host
   */
  public async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
    console.error("Registry MCP Server connected and running");
  }
}

/**
 * Main function to run the Registry MCP Server with a specific registry implementation
 * @param registry The registry implementation to use
 */
export async function startRegistryServer(registry: Registry): Promise<void> {
  const server = new RegistryMcpServer(registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Example usage (can be commented out or removed when importing this module elsewhere)
async function main() {
  const registry = new inMemoryRegistry();
  await registry.initialize();
  // await registry.addServer(
  //   "/Users/notzree/code/Personal/AI-thing/src/server.py",
  //   "stdio",
  // );
  await registry.addServer(
    "https://mcp.composio.dev/browserbase_tool/few-sticky-animal-ZVQ1XF",
    "sse",
  );
  startRegistryServer(registry).catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
main();
