import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolWithServerInfo } from "../../../shared/tools/tool";
export interface ToolStorer {
  upsertTool(tool: ToolWithServerInfo): Promise<void>;
  upsertTools(tools: ToolWithServerInfo[]): Promise<void>;
  deleteTool(toolId: string): Promise<void>;
  // may return null if tool for specific id is not found.
  getToolsById(toolIds?: string[]): Promise<ToolWithServerInfo | null[]>;
  getAllTools(limit?: number): Promise<ToolWithServerInfo[]>;
}
