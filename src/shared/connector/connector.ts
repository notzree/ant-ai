import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { execSync } from "child_process";

export type ConnectionOptions = {
  type: "stdio" | "sse";
  url: string;
  appName: string;
  appVersion: string;
};

// Connector class connects to an MCP server and returns a Client instance
export class Connector {
  /**
   * Create a new MCP client
   * @param appName Name of the application
   * @param appVersion Version of the application
   * @returns A new Client instance (not yet connected)
   */
  async connect(options: ConnectionOptions): Promise<Client> {
    const client = new Client({
      name: options.appName,
      version: options.appVersion,
    });
    if (options.type == "sse") {
      return await this.connectToSse(client, options.url);
    }
    if (options.type == "stdio") {
      return await this.connectToStdio(client, options.url);
    }
    throw new Error("Invalid connection type");
  }

  /**
   * Connect to an MCP server using STDIO transport
   * @param client The client to connect
   * @param serverScriptPath Path to the server script (.js or .py)
   * @returns The connected Client object
   */
  async connectToStdio(
    client: Client,
    serverScriptPath: string,
  ): Promise<Client> {
    const isJs = serverScriptPath.endsWith(".js");
    const isPy = serverScriptPath.endsWith(".py");
    const isTs = serverScriptPath.endsWith(".ts");

    if (!isJs && !isPy && !isTs) {
      throw new Error("Server script must be a .js or .py or .ts file");
    }

    let command: string;
    let args: string[] = [];

    if (isPy) {
      try {
        const uvPath = execSync("which uv").toString().trim();
        command = uvPath;
        args = ["run", "--with", "mcp[cli]", "mcp", "run"];
      } catch (e) {
        throw new Error("uv is not installed or not in PATH");
      }
    } else if (isTs) {
      command = "bun";
    } else {
      command = process.execPath;
    }

    const transport = new StdioClientTransport({
      command,
      args: args.concat([serverScriptPath]),
    });

    await client.connect(transport);
    return client;
  }

  /**
   * Connect to an MCP server using SSE transport
   * @param client The client to connect
   * @param sseUrl URL to the SSE server
   * @returns The connected Client object
   */
  async connectToSse(client: Client, sseUrl: string): Promise<Client> {
    const transport = new SSEClientTransport(new URL(sseUrl));
    await client.connect(transport);
    return client;
  }
}
