import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { type Tool as AnthropicTool } from "@anthropic-ai/sdk/src/resources/index.js";
import { Message, type Conversation } from "../../shared/messages/messages";
import { type Agent } from "./agent";
import { Anthropic } from "@anthropic-ai/sdk";
import { toAnthropic } from "../../shared/tools/tool";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

/*
  AnthropicAgent implements the Agent interface.
*/
export class AnthropicAgent implements Agent {
  public systemPrompt: string;
  public model: string;
  public maxTokens: number;
  private anthropic: Anthropic;
  constructor(systemPrompt: string, model: string, maxTokens: number) {
    this.systemPrompt = systemPrompt;
    this.model = model;
    this.maxTokens = maxTokens;
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }

  public async chat(
    conversation: Conversation,
    tools?: MCPTool[],
  ): Promise<Conversation> {
    const anthropicMessages = conversation.map((message) =>
      message.toAnthropicMessageParam(),
    );
    const anthropicTools = tools ? toAnthropic(tools) : [];

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: anthropicMessages,
      system: this.systemPrompt,
      tools: anthropicTools,
    });
    return [Message.fromAnthropicMessage(response)];
  }
}
