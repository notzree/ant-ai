import type { Registry } from "./registry";
import type { AntTool } from "../shared/tools/tool";
import { FakeTool } from "../shared/tools/fakeTool";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";

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

  /**
   * Add a tool to the vector store
   * @param tool - The tool to add
   * @returns The added tool
   */
  public async addTool(tool: AntTool): Promise<AntTool> {
    if (!this.vectorStore) {
      await this.initialize();
    }

    // Ensure the tool has an ID
    if (!tool.id) {
      tool.id = this.generateId();
    }

    // Store the tool in our Map for quick retrieval
    this.tools.set(tool.id, tool);

    // Create a document for the vector store
    const document = new Document({
      pageContent: `${tool.name}: ${tool.description}`,
      metadata: {
        id: tool.id,
        name: tool.name,
        toolData: JSON.stringify(tool), // Store the full tool data as JSON
      },
    });

    // Add to vector store
    await this.vectorStore!.addDocuments([document]);
    console.log(`Tool added: ${tool.name} (ID: ${tool.id})`);

    return tool;
  }

  /**
   * Delete a tool by ID
   * @param id - The ID of the tool to delete
   * @returns boolean indicating success
   */
  public async deleteTool(id: string): Promise<boolean> {
    if (!this.vectorStore || !this.tools.has(id)) {
      console.log(`Tool with ID ${id} not found`);
      return false;
    }

    // Remove from our tools Map
    const tool = this.tools.get(id);
    this.tools.delete(id);

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
              id: tool.id,
              name: tool.name,
              toolData: JSON.stringify(tool),
            },
          }),
      ),
      this.embeddings,
    );

    console.log(`Tool deleted: ${tool?.name} (ID: ${id})`);
    return true;
  }

  /**
   * Delete a tool by name
   * @param name - The name of the tool to delete
   * @returns boolean indicating success
   */
  public async deleteToolByName(name: string): Promise<boolean> {
    // Find the tool with the given name
    const tool = Array.from(this.tools.values()).find((t) => t.name === name);

    if (!tool) {
      console.log(`Tool with name ${name} not found`);
      return false;
    }

    // Delete by ID
    return this.deleteTool(tool.id);
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

  /**
   * Get a specific tool by ID
   * @param id - The ID of the tool to get
   * @returns The tool or undefined if not found
   */
  public getToolById(id: string): AntTool | undefined {
    return this.tools.get(id);
  }

  /**
   * Generate a simple ID
   * @returns A unique ID
   */
  private generateId(): string {
    return `tool_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }
}

// Example usage
async function runExample() {
  try {
    const registry = new inMemoryRegistry();
    await registry.initialize();

    // Add some tools
    await registry.addTool(
      new FakeTool(
        "tool1",
        "TextSummarizer",
        "Summarizes long text into concise bullet points.",
        "https://example.com/text-summarization",
      ),
    );

    await registry.addTool(
      new FakeTool(
        "tool2",
        "ImageAnalyzer",
        "Analyzes images to extract objects, text, and sentiment.",
        "https://example.com/image-analysis",
      ),
    );

    await registry.addTool(
      new FakeTool(
        "tool3",
        "DataVisualizer",
        "Creates charts and graphs from tabular data.",
        "https://example.com/data-visualization",
      ),
    );

    await registry.addTool(
      new FakeTool(
        "tool4",
        "SentimentAnalyzer",
        "Analyzes text to determine sentiment.",
        "https://example.com/sentiment-analysis",
      ),
    );

    await registry.addTool(
      new FakeTool(
        "tool5",
        "TextSummarizer",
        "Summarizes long texts into concise summaries.",
        "https://example.com/text-summarization",
      ),
    );

    // Search for tools
    console.log("\nSearching for analysis tools:");
    const analysisTools = await registry.queryTools("analyze data", 2);
    analysisTools.forEach((tool, i) => {
      console.log(`\n--- Result ${i + 1} ---`);
      console.log(`Name: ${tool.name}`);
      console.log(`Description: ${tool.description}`);
      console.log(`ID: ${tool.id}`);
    });

    // Delete a tool by name
    console.log("\nDeleting DataVisualizer tool:");
    await registry.deleteToolByName("DataVisualizer");

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
