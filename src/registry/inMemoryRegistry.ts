import type { Registry } from "./registry";
import { AntTool } from "../shared/tools/tool";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

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
      console.log("LocalRegistry initialized with empty vector store");
    }
  }

  public async addServer(
    client: Client,
    serverUrl: string,
  ): Promise<AntTool[]> {
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
    this.tools.set(tool.serverUrl, tool);

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
    console.log(`Tool added: ${tool.name} (ID: ${tool.name})`);

    return tool;
  }

  /**
   * Delete a tool by ID
   * @param name - The ID of the tool to delete
   * @returns boolean indicating success
   */
  public async deleteTool(name: string): Promise<boolean> {
    if (!this.vectorStore || !this.tools.has(name)) {
      console.log(`Tool with ID ${name} not found`);
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

    console.log(`Tool deleted: ${tool?.name}`);
    return true;
  }

  /**
   * Search for tools based on a query string
   * @param query - The search query
   * @param limit - The maximum number of results to return (default: 5)
   * @returns The matching tools
   */
  public async queryTools(query: string, limit?: number): Promise<AntTool[]> {
    if (!this.vectorStore) {
      await this.initialize();
      return []; // Return empty array if we just initialized (no tools yet)
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

// Example usage
async function runExample() {
  try {
    const registry = new inMemoryRegistry();
    await registry.initialize();

    // Add some tools
    await registry.addTool(
      new AntTool(
        "tool1",
        "TextSummarizer",
        "Summarizes long text into concise bullet points.",
        {},
      ),
    );

    await registry.addTool(
      new AntTool(
        "tool2",
        "ImageAnalyzer",
        "Analyzes images to extract objects, text, and sentiment.",
        {},
      ),
    );

    await registry.addTool(
      new AntTool(
        "tool3",
        "DataVisualizer",
        "Creates charts and graphs from tabular data.",
        {},
      ),
    );

    await registry.addTool(
      new AntTool(
        "tool4",
        "SentimentAnalyzer",
        "Analyzes text to determine sentiment.",
        {},
      ),
    );

    await registry.addTool(
      new AntTool(
        "tool5",
        "TextSummarizer",
        "Summarizes long texts into concise summaries.",
        {},
      ),
    );

    await registry.addTool(
      new AntTool(
        "tool6",
        "TextSummarizer",
        "Summarizes long texts into concise summaries.",
        {},
      ),
    );

    // Search for tools
    console.log("\nSearching for analysis tools:");
    const analysisTools = await registry.queryTools("analyze data", 2);
    analysisTools.forEach((tool, i) => {
      console.log(`\n--- Result ${i + 1} ---`);
      console.log(`Name: ${tool.name}`);
      console.log(`Description: ${tool.description}`);
    });

    // Search again
    console.log("\nSearching again after deletion:");
    const remainingTools = await registry.queryTools("visualize", 2);
    remainingTools.forEach((tool, i) => {
      console.log(`\n--- Result ${i + 1} ---`);
      console.log(`Name: ${tool.name}`);
      console.log(`Description: ${tool.description}`);
    });

    // List all tools
    console.log("\nAll remaining tools:");
    const allTools = await registry.listTools();
    allTools.forEach((tool, i) => {
      console.log(`${i + 1}. ${tool.name} (${tool.id})`);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

runExample();
