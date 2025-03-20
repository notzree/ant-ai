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
      "Search for tools based on a query string and add the resulting tools to your list of available tools.",
      {
        query: z
          .string()
          .describe("The search query describing the required actions"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default: 5)"),
      },
      async ({ query, limit }) => {
        try {
          const tools = await this.registry.queryTools(query, limit);
          // Convert the tools into a serializable array of ToolWithServerInfo
          const serializableTools = tools.map((item) => ({
            tool: item.tool,
            server: {
              url: item.server.url,
              type: item.server.type,
              authToken: item.server.authToken,
            },
          }));

          const jsonString = JSON.stringify(serializableTools);

          return {
            content: [
              {
                type: "text",
                text: jsonString,
                isJson: true,
              },
            ],
          };
        } catch (error) {
          console.error("Error querying tools:", error);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(null),
                isJson: true,
              },
              {
                type: "text",
                text: `Error querying tools: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );
    // // Tool: Add multiple servers concurrently to the registry
    // this.server.tool(
    //   "add-servers-concurrently",
    //   "Add tools from multiple MCP servers concurrently",
    //   {
    //     serverStrings: z
    //       .array(z.string())
    //       .describe(
    //         "Array of server strings in format 'url::type' where type is 'stdio' or 'sse'",
    //       ),
    //     authTokens: z
    //       .record(z.string())
    //       .optional()
    //       .describe(
    //         "Optional map of server URLs to their authentication tokens",
    //       ),
    //   },
    //   async ({ serverStrings, authTokens }) => {
    //     try {
    //       // Convert record to Map if authTokens is provided
    //       const authTokensMap = authTokens
    //         ? new Map(Object.entries(authTokens))
    //         : undefined;

    //       const result = await this.registry.addServersConcurrently(
    //         serverStrings,
    //         authTokensMap,
    //       );

    //       // Calculate total number of tools added
    //       let totalTools = 0;
    //       result.forEach((tools) => {
    //         totalTools += tools.length;
    //       });

    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: JSON.stringify(Array.from(result.entries())),
    //             isJson: true,
    //           },
    //           {
    //             type: "text",
    //             text: `Added ${totalTools} tools from ${serverStrings.length} servers concurrently`,
    //           },
    //         ],
    //       };
    //     } catch (error) {
    //       console.error("Error adding servers concurrently:", error);
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: JSON.stringify(null),
    //             isJson: true,
    //           },
    //           {
    //             type: "text",
    //             text: `Error adding servers concurrently: ${error instanceof Error ? error.message : String(error)}`,
    //           },
    //         ],
    //       };
    //     }
    //   },
    // );

    // // Tool: Add a server to the registry
    // this.server.tool(
    //   "add-server",
    //   "Add all tools from an MCP server to the registry",
    //   {
    //     serverString: z
    //       .string()
    //       .describe(
    //         "Server string in format 'url::type' where type is 'stdio' or 'sse'",
    //       ),
    //     authToken: z
    //       .string()
    //       .optional()
    //       .describe("Optional authentication token for the server"),
    //   },
    //   async ({ serverString, authToken }) => {
    //     try {
    //       const addedTools = await this.registry.addServer(
    //         serverString,
    //         authToken,
    //       );
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: JSON.stringify(addedTools),
    //             isJson: true,
    //           },
    //           {
    //             type: "text",
    //             text: `Added ${addedTools.length} tools from server ${serverString.split("::")[0]}`,
    //           },
    //         ],
    //       };
    //     } catch (error) {
    //       console.error("Error adding server:", error);
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: JSON.stringify(null),
    //             isJson: true,
    //           },
    //           {
    //             type: "text",
    //             text: `Error adding server: ${error instanceof Error ? error.message : String(error)}`,
    //           },
    //         ],
    //       };
    //     }
    //   },
    // );

    // Tool: List all tools in the registry
    this.server.tool(
      "list-tools",
      "Preview all of the tools available in the registry. These tools require you to query the registry to use them.",
      {},
      async () => {
        try {
          const tools = await this.registry.listTools();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(tools),
                isJson: true,
              },
              {
                type: "text",
                text:
                  tools.length > 0
                    ? `Found ${tools.length} tools`
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
                text: JSON.stringify(null),
                isJson: true,
              },
              {
                type: "text",
                text: `Error listing tools: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );

    // // Tool: Delete a tool from the registry
    // this.server.tool(
    //   "delete-tool",
    //   "Delete a tool from the registry",
    //   {
    //     name: z.string().describe("The ID of the tool to delete"),
    //   },
    //   async ({ name }) => {
    //     try {
    //       const success = await this.registry.deleteTool(name);
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: JSON.stringify(success),
    //             isJson: true,
    //           },
    //           {
    //             type: "text",
    //             text: success
    //               ? `Tool '${name}' deleted successfully.`
    //               : `Tool '${name}' not found or could not be deleted.`,
    //           },
    //         ],
    //       };
    //     } catch (error) {
    //       console.error("Error deleting tool:", error);
    //       return {
    //         content: [
    //           {
    //             type: "text",
    //             text: JSON.stringify(null),
    //             isJson: true,
    //           },
    //           {
    //             type: "text",
    //             text: `Error deleting tool: ${error instanceof Error ? error.message : String(error)}`,
    //           },
    //         ],
    //       };
    //     }
    //   },
    // );
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
  await registry.addServersConcurrently([
    "https://mcp.composio.dev/browserbase_tool/few-sticky-animal-ZVQ1XF::sse",
    "https://mcp.composio.dev/gmail/wonderful-odd-gigabyte-aJZbFe::sse",
    "https://mcp.composio.dev/googledocs/wonderful-odd-gigabyte-aJZbFe::sse",
  ]);
  startRegistryServer(registry).catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
main();
