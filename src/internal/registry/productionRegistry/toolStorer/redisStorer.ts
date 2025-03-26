import Redis from "ioredis";
import { type ToolStorer } from "./storer";
import type { ToolWithServerInfo } from "../../../shared/tools/tool";

const UPSTASH_API_KEY = process.env.UPSTASH_API_KEY;
if (!UPSTASH_API_KEY) {
  throw new Error("UPSTASH_API_KEY is not set");
}

export class RedisToolStorer implements ToolStorer {
  private client: Redis;

  constructor() {
    this.client = new Redis(UPSTASH_API_KEY as string);
  }

  async upsertTool(tool: ToolWithServerInfo): Promise<void> {
    try {
      const toolId = `${tool.server.url}-${tool.tool.name}`;
      await this.client.call("JSON.SET", toolId, "$", JSON.stringify(tool));
    } catch (error) {
      throw new Error(`Failed to upsert tool: ${(error as Error).message}`);
    }
  }

  async upsertTools(tools: ToolWithServerInfo[]): Promise<void> {
    try {
      const pipeline = this.client.pipeline();
      for (const tool of tools) {
        const toolId = `${tool.server.url}-${tool.tool.name}`;
        pipeline.call("JSON.SET", toolId, "$", JSON.stringify(tool));
      }
      await pipeline.exec();
    } catch (error) {
      throw new Error(`Failed to upsert tools: ${(error as Error).message}`);
    }
  }

  async deleteTool(toolId: string): Promise<void> {
    try {
      // Using RedisJSON's JSON.DEL command
      await this.client.call("JSON.DEL", toolId);
    } catch (error) {
      throw new Error(
        `Failed to delete tool ${toolId}: ${(error as Error).message}`,
      );
    }
  }

  async getToolsById(toolIds?: string[]): Promise<ToolWithServerInfo | null[]> {
    try {
      if (!toolIds || toolIds.length === 0) {
        return [];
      }

      // Create a pipeline for fetching multiple tools
      const pipeline = this.client.pipeline();

      // Queue all JSON.GET operations in the pipeline
      for (const toolId of toolIds) {
        pipeline.call("JSON.GET", toolId, "$");
      }

      // Execute the pipeline
      const results = await pipeline.exec();

      if (!results) {
        return [];
      }

      // Process the results
      const tools: ToolWithServerInfo | null[] = new Array(toolIds.length);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result == null) {
          continue;
        }
        const err = result[0];
        const data = result[1];

        if (err) {
          console.error(`Error fetching tool ${toolIds[i]}: ${err.message}`);
          throw err;
        }

        if (!data) {
          console.warn(`No data found for tool ${toolIds[i]}`);
          tools[i] = null;
        }

        try {
          const tool = JSON.parse(data as string);
          tools[i] = tool;
        } catch (parseError) {
          console.error(
            `Error parsing tool ${toolIds[i]}: ${(parseError as Error).message}`,
          );
          throw parseError;
        }
      }

      return tools;
    } catch (error) {
      throw new Error(`Failed to get tools by ID: ${(error as Error).message}`);
    }
  }

  async getAllTools(limit?: number): Promise<ToolWithServerInfo[]> {
    try {
      // Get all tool keys
      const keys = await this.client.keys("*");

      if (keys.length === 0) {
        return [];
      }

      // Apply limit if specified
      const keysToFetch = limit ? keys.slice(0, limit) : keys;

      // Create a pipeline for fetching multiple tools
      const pipeline = this.client.pipeline();

      // Queue all JSON.GET operations in the pipeline
      for (const key of keysToFetch) {
        pipeline.call("JSON.GET", key, "$");
      }

      // Execute the pipeline
      const results = await pipeline.exec();

      if (!results) {
        return [];
      }

      // Process the results
      const tools: ToolWithServerInfo[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result == null) {
          continue;
        }
        const err = result[0];
        const data = result[1];

        if (err) {
          console.error(
            `Error fetching tool ${keysToFetch[i]}: ${err.message}`,
          );
          throw err;
        }

        if (!data) {
          console.warn(`No data found for tool ${keysToFetch[i]}`);
          continue;
        }

        try {
          const tool = JSON.parse(data as string);
          tools.push(tool);
        } catch (parseError) {
          console.error(
            `Error parsing tool ${keysToFetch[i]}: ${(parseError as Error).message}`,
          );
          throw parseError;
        }
      }

      return tools;
    } catch (error) {
      throw new Error(`Failed to get all tools: ${(error as Error).message}`);
    }
  }

  async getToolField(toolId: string, path: string): Promise<any> {
    const result = await this.client.call("JSON.GET", toolId, path);
    if (!result) {
      return null;
    }
    return JSON.parse(result as string);
  }

  async updateToolField(
    toolId: string,
    path: string,
    value: any,
  ): Promise<void> {
    await this.client.call("JSON.SET", toolId, path, JSON.stringify(value));
  }
}
