import type { AntTool } from "../shared/tools/tool";

export interface Registry {
  // Query tools in the registry
  queryTools(query: string, limit?: number): Promise<AntTool[]>;

  // Add a tool to the registry.
  addTool(tool: AntTool): Promise<AntTool>;

  // List all tools in the registry.
  listTools(): Promise<AntTool[]>;

  // deletes a tool from the registry
  deleteTool(id: string): Promise<boolean>;
}
