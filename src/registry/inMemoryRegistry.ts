import type { Registry } from "./registry";
import { AntTool } from "../shared/tools/tool";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import type { MCPServer } from "../shared/mcpServer/server";

export class inMemoryRegistry implements Registry {
  private vectorStore: MemoryVectorStore | null = null;
  private embeddings: OpenAIEmbeddings;
  private tools: Map<string, AntTool> = new Map();

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
      // console.log("LocalRegistry initialized with empty vector store");
    }
  }

  public async addServer(
    serverUrl: string,
    type: "stdio" | "sse",
  ): Promise<AntTool[]> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }
    const connector = new Connector();
    const opts: ConnectionOptions = {
      type: type,
      url: serverUrl,
      appName: "ant",
      appVersion: "1.0.0",
    };
    const client = await connector.connect(opts);
    const tools = await AntTool.FromClient(client, serverUrl);
    const result = new Array(tools.length);

    const promises = tools.map(async (tool, index) => {
      result[index] = await this.addTool(tool);
    });

    await Promise.all(promises);
    return result;
  }

  /**
   * Add a tool to the vector store
   * @param tool - The tool to add
   * @returns The added tool
   */
  public async addTool(tool: AntTool): Promise<AntTool> {
    if (!this.vectorStore) {
      await this.initialize();
    }

    // Store the tool in our Map for quick retrieval
    this.tools.set(tool.name, tool);

    // Create a document for the vector store
    const document = new Document({
      pageContent: `${tool.name}: ${tool.description}`,
      metadata: {
        serverUrl: tool.serverUrl,
        name: tool.name,
        toolData: JSON.stringify(tool), // Store the full tool data as JSON
      },
    });

    // Add to vector store
    await this.vectorStore!.addDocuments([document]);
    // console.log(`Tool added: ${tool.name} (ID: ${tool.name})`);
    return tool;
  }

  /**
   * Delete a tool by ID
   * @param name - The ID of the tool to delete
   * @returns boolean indicating success
   */
  public async deleteTool(name: string): Promise<boolean> {
    if (!this.vectorStore || !this.tools.has(name)) {
      // console.log(`Tool with ID ${name} not found`);
      return false;
    }

    // Remove from our tools Map
    const tool = this.tools.get(name);
    this.tools.delete(name);

    // For in-memory vector store, we need to recreate it without the deleted document
    // since MemoryVectorStore doesn't support direct deletion
    const remainingTools = Array.from(this.tools.values());

    // Recreate the vector store
    this.vectorStore = await MemoryVectorStore.fromDocuments(
      remainingTools.map(
        (tool) =>
          new Document({
            pageContent: `${tool.name}: ${tool.description}`,
            metadata: {
              serverUrl: tool.serverUrl,
              name: tool.name,
              toolData: JSON.stringify(tool),
            },
          }),
      ),
      this.embeddings,
    );

    // console.log(`Tool deleted: ${tool?.name}`);
    return true;
  }

  /**
   * Search for tools based on a query string
   * @param query - The search query
   * @param limit - The maximum number of results to return (default: 5)
   * @returns a promise resolving to an array of servers to connect to.
   */
  public async queryTools(query: string, limit?: number): Promise<MCPServer[]> {
    if (!this.vectorStore) {
      await this.initialize();
      return []; // Return empty array if we just initialized (no servers)
    }
    if (!limit) {
      // Default limit
      limit = 5;
    }

    // Perform similarity search
    const results = await this.vectorStore.similaritySearch(query, limit);

    // Convert results back to AntTool objects
    return results.map((doc) => {
      try {
        return JSON.parse(doc.metadata.toolData as string) as AntTool;
      } catch (e) {
        console.error(`Error parsing tool data for ${doc.metadata.name}:`, e);
        throw new Error("failed to parse tool data");
      }
    });
  }

  /**
   * Get all tools
   * @returns Array of all tools
   */
  public async listTools(): Promise<AntTool[]> {
    return Promise.resolve(Array.from(this.tools.values()));
  }
}

// async function main() {
//   const registry = new inMemoryRegistry();
//   await registry.initialize();

//   const tools = await registry.listTools();
//   console.log(tools);
// }
// main();
