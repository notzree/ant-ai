import { DynamoDB } from "../../../../integrations/dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  GetCommand,
  BatchGetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { type ToolStorer } from "./storer";
import type { ToolWithServerInfo } from "../../../shared/tools/tool";

const TABLE_NAME = "REGISTRY_STORE";
export class DynamoDBToolStorer implements ToolStorer {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const dynamoClient = DynamoDB;
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = TABLE_NAME;
  }

  async upsertTool(tool: ToolWithServerInfo): Promise<void> {
    try {
      const toolId = `${tool.server.url}-${tool.tool.name}`;

      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            id: toolId,
            data: tool,
          },
        }),
      );
    } catch (error) {
      throw new Error(`Failed to upsert tool: ${(error as Error).message}`);
    }
  }

  async upsertTools(tools: ToolWithServerInfo[]): Promise<void> {
    try {
      // DynamoDB doesn't have a native batch upsert like Redis pipeline
      // We need to process each item individually
      const promises = tools.map((tool) => {
        const toolId = `${tool.server.url}-${tool.tool.name}`;
        return this.client.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              id: toolId,
              data: tool,
            },
          }),
        );
      });

      await Promise.all(promises);
    } catch (error) {
      throw new Error(`Failed to upsert tools: ${(error as Error).message}`);
    }
  }

  async deleteTool(toolId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            id: toolId,
          },
        }),
      );
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

      // DynamoDB batch get can only handle up to 100 items at a time
      const batchSize = 100;
      const results: (ToolWithServerInfo | null)[] = new Array(
        toolIds.length,
      ).fill(null);

      // Process in batches
      for (let i = 0; i < toolIds.length; i += batchSize) {
        const batchIds = toolIds.slice(i, i + batchSize);
        const batchKeys = batchIds.map((id) => ({ id }));

        const response = await this.client.send(
          new BatchGetCommand({
            RequestItems: {
              [this.tableName]: {
                Keys: batchKeys,
              },
            },
          }),
        );

        // Process the results
        const items = response.Responses?.[this.tableName] || [];

        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          if (!item) continue;
          const itemIndex = toolIds.indexOf(item.id);

          if (itemIndex !== -1) {
            results[itemIndex] = item.data as ToolWithServerInfo;
          }
        }
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to get tools by ID: ${(error as Error).message}`);
    }
  }

  async getAllTools(limit?: number): Promise<ToolWithServerInfo[]> {
    try {
      const params: any = {
        TableName: this.tableName,
      };

      if (limit) {
        params.Limit = limit;
      }

      const response = await this.client.send(new ScanCommand(params));
      const items = response.Items || [];

      return items.map((item) => item.data as ToolWithServerInfo);
    } catch (error) {
      throw new Error(`Failed to get all tools: ${(error as Error).message}`);
    }
  }

  // Additional methods not in the interface but present in Redis implementation

  async getToolField(toolId: string, path: string): Promise<any> {
    try {
      const response = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            id: toolId,
          },
        }),
      );

      if (!response.Item) {
        return null;
      }

      const tool = response.Item.data as ToolWithServerInfo;

      // Simple path handling for nested properties
      // This is a basic implementation and might need to be enhanced
      // for more complex path expressions
      const pathParts = path.split(".");
      let result: any = tool;

      for (const part of pathParts) {
        if (result === null || result === undefined) {
          return null;
        }
        result = result[part];
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to get tool field: ${(error as Error).message}`);
    }
  }

  async updateToolField(
    toolId: string,
    path: string,
    value: any,
  ): Promise<void> {
    try {
      // First, get the current tool
      const response = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            id: toolId,
          },
        }),
      );

      if (!response.Item) {
        throw new Error(`Tool with ID ${toolId} not found`);
      }

      const tool = response.Item.data as ToolWithServerInfo;

      // Update the specific field within the tool object
      // This is a simple implementation for basic path expressions
      const pathParts = path.split(".");
      let target = tool;

      // Navigate to the nested object that contains the field to update
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (!part) {
          throw new Error(`Invalid path part: ${part}`);
        }
        if (target[part] === undefined) {
          target[part] = {};
        }
        target = target[part];
      }

      // Update the field
      const lastPart = pathParts[pathParts.length - 1];
      target[lastPart] = value;

      // Save the updated tool back to DynamoDB
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            id: toolId,
            data: tool,
          },
        }),
      );
    } catch (error) {
      throw new Error(
        `Failed to update tool field: ${(error as Error).message}`,
      );
    }
  }
}
