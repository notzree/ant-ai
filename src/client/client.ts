import { Anthropic } from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  TextBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
  ContentBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import readline from "readline/promises";
import { BufferMemory } from "langchain/memory";
import { ToolStore } from "../shared/tools/toolStore";
import { type ConnectionOptions } from "../shared/connector/connector";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { RegistryClient } from "../registry/registryClient";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}
const ANT_VERSION = process.env.ANT_VERSION || "1.0.0";
const MODEL_NAME = process.env.MODEL_NAME || "claude-3-5-sonnet-20241022";
const MAX_RECURSION_DEPTH = 3; // Maximum number of re-evaluations

export class AntClient {
  private memory: BufferMemory;
  private anthropic: Anthropic;
  private toolStore: ToolStore;
  private chatHistory: BaseMessage[] = [];

  constructor(rc: RegistryClient) {
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.memory = new BufferMemory({
      memoryKey: "chat_history",
      returnMessages: true,
    });
    this.toolStore = new ToolStore(rc);
  }

  async connectToServer(url: string, type: "sse" | "stdio") {
    const opts: ConnectionOptions = {
      type: type,
      url: url,
      appName: "ant",
      appVersion: ANT_VERSION,
    };
    try {
      this.toolStore.connectToServer(opts);
    } catch (e) {
      console.log(`Failed to connect to MCP server ${url}: `, e);
      throw e;
    }
  }

  /**
   * Process a user query, potentially recursively if new tools are discovered
   * @param query The user's query
   * @param recursionDepth Current recursion depth (default: 0)
   * @param previousMessages Previous conversation messages (optional)
   * @param previousTools Previously available tools count (optional)
   * @param previousResponses Accumulated responses from previous recursion levels (optional)
   * @returns The final response after all processing stages
   */
  async processQuery(
    query: string,
    recursionDepth: number = 0,
    previousMessages: MessageParam[] = [],
    previousTools: number = 0,
    previousResponses: string[] = [],
  ): Promise<string> {
    try {
      // Stop if we've reached max recursion depth
      if (recursionDepth >= MAX_RECURSION_DEPTH) {
        previousResponses.push(
          `[Maximum re-evaluation depth reached (${MAX_RECURSION_DEPTH}). Finalizing response.]`,
        );

        // Return all accumulated responses
        const finalResponse = previousResponses.join("\n\n");

        // Save to chat history on final return only
        if (recursionDepth === 0) {
          this.chatHistory.push(new AIMessage(finalResponse));
          await this.memory.saveContext(
            { input: query },
            { output: finalResponse },
          );
        }

        return finalResponse;
      }

      // Prepare conversation messages
      let messages: MessageParam[];

      if (recursionDepth === 0) {
        // Initial execution: load from memory and create messages
        const memoryResult = await this.memory.loadMemoryVariables({});
        const chatHistoryMessages = memoryResult.chat_history || [];

        // Convert chat history to MessageParam format for Anthropic API
        messages = [
          ...chatHistoryMessages.map((msg: BaseMessage) => ({
            role: msg.getType() === "human" ? "user" : "assistant",
            content: msg.content,
          })),
          { role: "user", content: query },
        ];

        // Add the user's query to chat history on first execution only
        this.chatHistory.push(new HumanMessage(query));
      } else {
        // For recursion: use provided messages and add re-evaluation instruction
        messages = [
          ...previousMessages,
          {
            role: "user",
            content: `New tools have been added since your last response. Please re-evaluate the original query with your expanded toolset (recursion level: ${recursionDepth}): "${query}"`,
          },
        ];
      }

      // Get current available tools count
      const initialToolCount = this.toolStore.getAvailableTools().length;

      // Log recursion level and tool status
      const levelPrefix =
        recursionDepth > 0 ? `[Re-evaluation ${recursionDepth}] ` : "";
      const toolsMessage = `${levelPrefix}Processing with ${initialToolCount} available tools`;
      const responseElements = [];

      if (recursionDepth > 0) {
        responseElements.push(toolsMessage);
        // Show how many new tools were added
        const newToolsCount = initialToolCount - previousTools;
        if (newToolsCount > 0) {
          responseElements.push(
            `${levelPrefix}${newToolsCount} new tools added since last evaluation`,
          );
        }
      }

      // Call the model
      const response = await this.anthropic.messages.create({
        model: MODEL_NAME,
        max_tokens: 1000,
        messages,
        tools: this.toolStore.getAvailableTools(),
      });

      // Process response and handle tool calls
      for (const content of response.content) {
        if (content.type === "text") {
          responseElements.push(content.text);
        } else if (content.type === "tool_use") {
          const toolName = content.name;
          const toolArgs = content.input as
            | { [x: string]: unknown }
            | undefined;
          const toolId =
            content.id ||
            `tool_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

          responseElements.push(
            `${levelPrefix}Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}`,
          );

          try {
            const { rawResult } = await this.toolStore.executeTool(
              toolName,
              toolArgs,
            );

            responseElements.push(
              `${levelPrefix}Tool ${toolName} returned ${JSON.stringify(rawResult)}`,
            );

            // Construct the tool response pathway
            const assistantTextBlock: TextBlockParam = {
              type: "text",
              text: responseElements.join("\n"),
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
              tools: this.toolStore.getAvailableTools(),
            });

            if (toolResponse && toolResponse.content.length > 0) {
              const toolResponseText =
                toolResponse.content[0].type === "text"
                  ? toolResponse.content[0].text
                  : "";
              responseElements.push(toolResponseText);
            }
          } catch (error) {
            responseElements.push(
              `${levelPrefix}Error calling tool ${toolName}: ${error.message}`,
            );
          }
        }
      }

      // Combine all response elements
      const currentResponse = responseElements.join("\n");

      // Add current level's response to accumulated responses
      const allResponses = [...previousResponses];
      if (recursionDepth > 0) {
        allResponses.push(`\n=== Re-evaluation Level ${recursionDepth} ===\n`);
      }
      allResponses.push(currentResponse);

      // Check if new tools were added during this cycle
      const finalToolCount = this.toolStore.getAvailableTools().length;
      const newToolsAdded = finalToolCount > initialToolCount;

      if (newToolsAdded) {
        // If new tools were added, recursively process the query again
        return this.processQuery(
          query,
          recursionDepth + 1,
          [...messages, { role: "assistant", content: currentResponse }],
          finalToolCount,
          allResponses,
        );
      } else {
        // No new tools added, return the final response
        const finalResponse = allResponses.join("\n\n");

        // Save to chat history on final return only
        if (recursionDepth === 0) {
          this.chatHistory.push(new AIMessage(finalResponse));
          await this.memory.saveContext(
            { input: query },
            { output: finalResponse },
          );
        }

        return finalResponse;
      }
    } catch (error) {
      console.error(
        `Error processing query (recursion depth ${recursionDepth}):`,
        error,
      );
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
