import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { Conversation } from "../../shared/messages/messages";
export interface Agent {
  systemPrompt: string;

  // chat takes in a conversation and optional tools to process the latest conversation with,
  // and returns new elements of the conversation (does not include the original conversation)
  chat(conversation: Conversation, tools?: MCPTool[]): Promise<Conversation>;
}
