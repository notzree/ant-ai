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
import fs from "fs";
import path from "path";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}
const ANT_VERSION = process.env.ANT_VERSION || "1.0.0";
const MODEL_NAME = process.env.MODEL_NAME || "claude-3-5-sonnet-20241022";
const MAX_RECURSION_DEPTH = 10; // Maximum number of re-evaluations

export class AntClient {
  private memory: BufferMemory;
  private anthropic: Anthropic;
  private toolStore: ToolStore;
  private chatHistory: BaseMessage[] = [];
  private logFile: string;
  private logStream: fs.WriteStream;

  constructor(rc: RegistryClient) {
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.memory = new BufferMemory({
      memoryKey: "chat_history",
      returnMessages: true,
    });
    this.toolStore = new ToolStore(rc);

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFile = path.join(process.cwd(), `ant-chat-${timestamp}.log`);
    this.logStream = fs.createWriteStream(this.logFile, { flags: "a" });
    this.log(`Log session started at ${new Date().toISOString()}`);
  }

  /**
   * Log message to the log file
   */
  private log(message: string) {
    const timestamp = new Date().toISOString();
    this.logStream.write(`[${timestamp}] ${message}\n`);
  }

  async connectToServer(url: string, type: "sse" | "stdio") {
    const opts: ConnectionOptions = {
      type: type,
      url: url,
      appName: "ant",
      appVersion: ANT_VERSION,
    };
    try {
      this.log(`Connecting to MCP server at ${url}`);
      this.toolStore.connectToServer(opts);
      this.log(`Successfully connected to MCP server at ${url}`);
    } catch (e) {
      const errorMsg = `Failed to connect to MCP server ${url}: ${e}`;
      this.log(errorMsg);
      console.log(errorMsg);
      throw e;
    }
  }

  /**
   * Extract clean user-facing text from response elements
   * @param responseElements Array of response elements including logs and LLM text
   * @returns Clean text intended for user display
   */
  private extractUserFacingText(responseElements: string[]): string {
    // Filter out lines that are clearly logs
    return responseElements
      .filter(
        (line) =>
          !line.includes("Calling tool") &&
          !line.includes("Tool") &&
          !line.includes("returned") &&
          !line.includes("[Re-evaluation") &&
          !line.includes("Processing with") &&
          !line.includes("tools added") &&
          !line.includes("=== Re-evaluation Level"),
      )
      .join("\n")
      .replace(/TASK COMPLETE|FINAL ANSWER/g, "") // Remove task completion markers
      .trim();
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
  ): Promise<{
    fullLogs: string;
    userResponse: string;
    needsUserInput?: boolean;
  }> {
    try {
      this.log(
        `Processing query at recursion depth ${recursionDepth}: ${query}`,
      );

      // Stop if we've reached max recursion depth
      if (recursionDepth >= MAX_RECURSION_DEPTH) {
        const depthMessage = `[Maximum re-evaluation depth reached (${MAX_RECURSION_DEPTH}). Finalizing response.]`;
        this.log(depthMessage);
        previousResponses.push(depthMessage);

        const fullLogs = previousResponses.join("\n\n");
        const userResponse = this.extractUserFacingText(previousResponses);

        if (recursionDepth === 0) {
          this.chatHistory.push(new AIMessage(userResponse));
          await this.memory.saveContext(
            { input: query },
            { output: userResponse },
          );
        }

        return { fullLogs, userResponse };
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
        this.log(`Added user query to chat history: ${query}`);
      } else {
        // For recursion: use provided messages and add re-evaluation instruction
        const reEvalPrompt = `New tools have been added since your last response. Please re-evaluate the original query with your expanded toolset (recursion level: ${recursionDepth}): "${query}"`;
        this.log(`Re-evaluation prompt: ${reEvalPrompt}`);

        messages = [
          ...previousMessages,
          {
            role: "user",
            content: reEvalPrompt,
          },
        ];
      }

      // Get current available tools count
      const initialToolCount = this.toolStore.getAvailableTools().length;
      this.log(`Available tools count: ${initialToolCount}`);

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
          const newToolsMsg = `${levelPrefix}${newToolsCount} new tools added since last evaluation`;
          responseElements.push(newToolsMsg);
          this.log(newToolsMsg);
        }
      }

      // Call the model
      this.log(`Calling model ${MODEL_NAME} with ${messages.length} messages`);
      const response = await this.anthropic.messages.create({
        model: MODEL_NAME,
        max_tokens: 1000,
        messages,
        system:
          "When you have completed all steps of a task and no further action is needed, include 'TASK COMPLETE' or 'FINAL ANSWER' in your response. " +
          "If you need specific information from the user to proceed (like API keys, authorization, or clarification), include 'NEED_USER_INPUT:' followed by your specific request.",
        tools: this.toolStore.getAvailableTools(),
      });

      let toolCallsMade = 0;
      let taskComplete = false;
      let needsUserInput = false;
      let userInputRequest = "";

      // Process response and handle tool calls
      for (const content of response.content) {
        if (content.type === "text") {
          responseElements.push(content.text);
          this.log(
            `LLM text response: ${content.text.substring(0, 100)}${content.text.length > 100 ? "..." : ""}`,
          );
          if (content.text.includes("NEED_USER_INPUT")) {
            needsUserInput = true;
            userInputRequest = content.text;
            this.log(`LLM requires user input: ${content.text}...`);
          }

          if (
            content.text.includes("TASK COMPLETE") ||
            content.text.includes("FINAL ANSWER")
          ) {
            taskComplete = true;
            this.log("Task marked as complete by LLM");
          }
        } else if (content.type === "tool_use") {
          const toolName = content.name;
          const toolArgs = content.input as
            | { [x: string]: unknown }
            | undefined;
          const toolId =
            content.id ||
            `tool_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

          const toolCallMsg = `${levelPrefix}Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}`;
          responseElements.push(toolCallMsg);
          this.log(toolCallMsg);

          try {
            const { rawResult } = await this.toolStore.executeTool(
              toolName,
              toolArgs,
            );

            const toolResultMsg = `${levelPrefix}Tool ${toolName} returned ${JSON.stringify(rawResult)}`;
            responseElements.push(toolResultMsg);
            this.log(toolResultMsg);

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
            this.log(`Calling model with tool result for ${toolName}`);
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
              this.log(`Tool response from LLM: ${toolResponseText}`);
            }
          } catch (error) {
            const errorMsg = `${levelPrefix}Error calling tool ${toolName}: ${error.message}`;
            responseElements.push(errorMsg);
            this.log(errorMsg);
          }
          toolCallsMade++;
        }
      }

      // Combine all response elements
      const currentResponse = responseElements.join("\n");

      // Add current level's response to accumulated responses
      const allResponses = [...previousResponses];
      if (recursionDepth > 0) {
        const reEvalHeader = `\n=== Re-evaluation Level ${recursionDepth} ===\n`;
        allResponses.push(reEvalHeader);
        this.log(reEvalHeader);
      }
      allResponses.push(currentResponse);

      // Check if new tools were added during this cycle
      const finalToolCount = this.toolStore.getAvailableTools().length;
      const newToolsAdded = finalToolCount > initialToolCount;

      if (newToolsAdded) {
        this.log(
          `New tools added during processing. Initial: ${initialToolCount}, Final: ${finalToolCount}`,
        );
      }

      if (
        (toolCallsMade > 0 || newToolsAdded) &&
        !taskComplete &&
        !needsUserInput &&
        recursionDepth < MAX_RECURSION_DEPTH
      ) {
        // Continue processing the query
        this.log(`Continuing to next recursion level (${recursionDepth + 1})`);
        return this.processQuery(
          query,
          recursionDepth + 1,
          [...messages, { role: "assistant", content: currentResponse }],
          finalToolCount,
          allResponses,
        );
      } else {
        // Task is complete or no further action needed
        this.log(`Processing complete at recursion depth ${recursionDepth}`);
        const fullLogs = allResponses.join("\n\n");
        let userResponse;
        if (needsUserInput) {
          // Extract the user input request, cleaning up the marker
          const requestPattern = /NEED_USER_INPUT:?\s*(.+?)(?=\n\n|\n$|$)/s;
          const match = userInputRequest.match(requestPattern);

          if (match && match[1]) {
            userResponse = match[1].trim();
          } else {
            userResponse = userInputRequest
              .replace(/NEED_USER_INPUT:?/g, "")
              .trim();
          }

          // Add a clear prefix
          userResponse =
            "I need additional information to proceed: " + userResponse;
        } else {
          userResponse = this.extractUserFacingText(allResponses);
        }

        // Update chat history (if at top level)
        if (recursionDepth === 0) {
          this.chatHistory.push(new AIMessage(userResponse));
          await this.memory.saveContext(
            { input: query },
            { output: userResponse },
          );
        }

        // Return with an indicator if user input is needed
        return { fullLogs, userResponse, needsUserInput };
      }
    } catch (error) {
      const errorMsg = `Error processing query (recursion depth ${recursionDepth}): ${error.message}`;
      console.error(errorMsg);
      this.log(errorMsg);
      return {
        fullLogs: errorMsg,
        userResponse: `Error: ${error.message}`,
      };
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started with persistent memory!");
      console.log(`Logs being saved to: ${this.logFile}`);
      console.log("Type your queries or 'quit' to exit.");
      this.log("Chat loop started");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          this.log("User requested to quit");
          break;
        }

        this.log(`Received user query: ${message}`);
        const { fullLogs, userResponse } = await this.processQuery(message);

        // Log the full processing details but only show clean response to user
        this.log(`Full processing logs:\n${fullLogs}`);
        console.log("\n" + userResponse);
      }
    } finally {
      console.log("exiting...");
      this.log("Chat loop ended");
      this.logStream.end();
      rl.close();
    }
  }

  async cleanup() {
    this.log("Cleaning up resources");
    await this.toolStore.cleanup();
    this.logStream.end();
  }
}
