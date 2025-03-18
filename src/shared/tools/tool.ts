import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@anthropic-ai/sdk/resources/index.mjs";
// export class AntTool {
//   serverUrl: string;
//   name: string;
//   description: string;
//   inputSchema: object;

//   constructor(
//     serverUrl: string,
//     name: string,
//     description: string,
//     inputSchema: object,
//   ) {
//     this.serverUrl = serverUrl;
//     this.name = name;
//     this.description = description;
//     this.inputSchema = inputSchema;
//   }

//   static async FromClient(
//     client: Client,
//     serverUrl: string,
//   ): Promise<AntTool[]> {
//     try {
//       const toolsResult = await client.listTools();
//       const tools: AntTool[] = toolsResult.tools.map((tool) => {
//         return new AntTool(
//           serverUrl,
//           tool.name,
//           tool.description || "",
//           tool.inputSchema,
//         );
//       });
//       return tools;
//     } catch (error) {
//       console.error("Error fetching tools:", error);
//       throw error;
//     }
//   }
// }

export const ToolsFromClient = async (
  client: Client,
  serverUrl: string,
): Promise<Tool[]> => {
  try {
    const toolsResult = await client.listTools();
    return toolsResult.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description || "",
        input_schema: tool.inputSchema,
      };
    });
  } catch (error) {
    console.error("Error fetching tools:", error);
    throw error;
  }
};
