import { Anthropic } from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  TextBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
  MessageCreateParams,
  ContentBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import readline from "readline/promises";
import { BufferMemory } from "langchain/memory";
import { ToolStore, type ToolHandler } from "../shared/tools/toolStore";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}
const ANT_VERSION = process.env.ANT_VERSION || "1.0.0";
const MODEL_NAME = process.env.MODEL_NAME || "claude-3-5-sonnet-20241022";

export class AntClient {
  private memory: BufferMemory;
  private anthropic: Anthropic;
  private toolStore: ToolStore = new ToolStore();
  private chatHistory: BaseMessage[] = [];

  constructor() {
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.memory = new BufferMemory({
      memoryKey: "chat_history",
      returnMessages: true,
    });
  }

  async connectToServer(
    url: string,
    type: "sse" | "stdio",
    toolHandlers?: Map<string, ToolHandler>,
  ) {
    const opts: ConnectionOptions = {
      type: type,
      url: url,
      appName: "ant",
      appVersion: ANT_VERSION,
    };
    try {
      this.toolStore.connectToServer(opts, toolHandlers);
    } catch (e) {
      console.log(`Failed to connect to MCP server ${url}: `, e);
      throw e;
    }
  }

  async processQuery(query: string) {
    try {
      // Get chat history from memory
      const memoryResult = await this.memory.loadMemoryVariables({});
      const chatHistoryMessages = memoryResult.chat_history || [];

      // Convert chat history to MessageParam format for Anthropic API
      const messages: MessageParam[] = [
        ...chatHistoryMessages.map((msg: BaseMessage) => ({
          role: msg._getType() === "human" ? "user" : "assistant",
          content: msg.content,
        })),
        { role: "user", content: query },
      ];

      // Add the user's query to chat history
      this.chatHistory.push(new HumanMessage(query));

      // Step 2: Process the query with the selected tools
      const response = await this.anthropic.messages.create({
        model: MODEL_NAME,
        max_tokens: 1000,
        messages,
        tools: this.toolStore.getAvailableTools(),
      });

      const finalText: string[] = [];
      // const toolCalls: { name: string; input: any; output: any }[] = []; todo: why tf r we using this

      // Process response and handle tool calls
      for (const content of response.content) {
        if (content.type === "text") {
          finalText.push(content.text);
        } else if (content.type === "tool_use") {
          const toolName = content.name;
          const toolArgs = content.input as
            | { [x: string]: unknown }
            | undefined;
          const toolId =
            content.id ||
            `tool_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

          finalText.push(
            `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
          );

          try {
            const { rawResult, callbackResult } =
              await this.toolStore.executeTool(toolName, toolArgs); // Record tool call for memory
            if (callbackResult) {
              finalText.push(
                `[Tool ${toolName} returned ${JSON.stringify(callbackResult)}]`,
              );
            } else {
              finalText.push(
                `[Tool ${toolName} returned ${JSON.stringify(rawResult)}]`,
              );
            }
            // toolCalls.push({ do we need this???
            //   name: toolName,
            //   input: toolArgs,
            //   output: rawResult,
            // });

            const assistantTextBlock: TextBlockParam = {
              type: "text",
              text: finalText.join("\n"),
            };

            const toolUseBlock: ToolUseBlockParam = {
              type: "tool_use",
              id: toolId,
              name: toolName,
              input: toolArgs,
            };

            const toolResultBlock: ToolResultBlockParam = {
              type: "tool_result",
              tool_use_id: toolId,
              content: rawResult as string,
            };

            // Create properly typed messages for the tool response
            const assistantMessage: MessageParam = {
              role: "assistant",
              content: [
                assistantTextBlock,
                toolUseBlock,
              ] as ContentBlockParam[],
            };

            const userMessage: MessageParam = {
              role: "user",
              content: [toolResultBlock] as ContentBlockParam[],
            };

            // Create a new messages array with proper types
            const toolResponseMessages: MessageParam[] = [
              ...messages,
              assistantMessage,
              userMessage,
            ];

            // Call the API with the typed message array
            const toolResponse = await this.anthropic.messages.create({
              model: MODEL_NAME,
              max_tokens: 1000,
              messages: toolResponseMessages,
            });

            if (toolResponse && toolResponse.content.length > 0) {
              const toolResponseText =
                toolResponse.content[0].type === "text"
                  ? toolResponse.content[0].text
                  : "";
              finalText.push(toolResponseText);
            }
          } catch (error) {
            finalText.push(`Error calling tool ${toolName}: ${error.message}`);
          }
        }
      }

      const assistantResponse = finalText.join("\n");

      // Add assistant's response to chat history
      this.chatHistory.push(new AIMessage(assistantResponse));

      // Save the updated chat history to memory
      await this.memory.saveContext(
        { input: query },
        { output: assistantResponse },
      );

      return assistantResponse;
    } catch (error) {
      console.error("Error processing query:", error);
      return `Error: ${error.message}`;
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started with persistent memory!");
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      console.log("exiting...");
      rl.close();
    }
  }

  async cleanup() {
    await this.toolStore.cleanup();
  }
}
