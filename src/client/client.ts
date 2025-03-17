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
import { ChatAnthropic } from "@langchain/anthropic";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import type { Registry } from "../registry/registry";
import type { AntTool } from "../shared/tools/tool";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}
const ANT_VERSION = process.env.ANT_VERSION || "1.0.0";
const MODEL_NAME = process.env.MODEL_NAME || "claude-3-5-sonnet-20241022";

export class AntClient {
  private memory: BufferMemory;
  private anthropic: Anthropic;
  private registry: Registry;
  private model: ChatAnthropic;
  private clientLookup = new Map<string, number>(); // maps from tool name -> client index in mcpClients array
  private mcpClients: Client[] = [];
  private availableTools: Tool[] = [];
  private chatHistory: BaseMessage[] = [];
  private connector: Connector = new Connector();

  constructor(registry: Registry) {
    this.registry = registry;
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.model = new ChatAnthropic({
      anthropicApiKey: ANTHROPIC_API_KEY,
      modelName: MODEL_NAME,
      temperature: 0.7,
    });

    this.memory = new BufferMemory({
      memoryKey: "chat_history",
      returnMessages: true,
    });
  }

  async connectToServer(url: string, type: "sse" | "stdio") {
    const opts: ConnectionOptions = {
      type: type,
      url: url,
      appName: "ant",
      appVersion: ANT_VERSION,
    };
    try {
      const mcpClient = await this.connector.connect(opts);
      this.mcpClients.push(mcpClient);

      const toolsResult = await mcpClient.listTools();
      // Add new tools to available tools
      const newTools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));

      for (const tool of newTools) {
        this.clientLookup.set(tool.name, this.mcpClients.length - 1);
      }

      this.availableTools.push(...newTools);

      console.log(
        `Connected to server ${url} with tools:`,
        newTools.map(({ name }) => name),
      );
    } catch (e) {
      console.log(`Failed to connect to MCP server ${url}: `, e);
      throw e;
    }
  }

  /**
   * Identifies required tasks from the user query and finds relevant tools
   */
  async identifyRequiredTools(query: string): Promise<Tool[]> {
    try {
      // Get chat history for context
      const memoryResult = await this.memory.loadMemoryVariables({});
      const chatHistoryMessages = memoryResult.chat_history || [];

      // Convert chat history to MessageParam format
      const messages: MessageParam[] = [
        ...chatHistoryMessages.map((msg: BaseMessage) => ({
          role: msg._getType() === "human" ? "user" : "assistant",
          content: msg.content,
        })),
        { role: "user", content: query },
      ];

      // Ask the LLM to identify required tasks with the system instruction as a parameter
      const taskAnalysisResponse = await this.anthropic.messages.create({
        model: MODEL_NAME,
        max_tokens: 300,
        system:
          "Analyze the user's query and identify specific tasks that need to be performed. List these tasks in a concise, structured format that can be used for tool selection. Focus on actionable tasks rather than general concepts.",
        messages,
      });

      // Extract tasks from the response
      const taskAnalysis = taskAnalysisResponse.content[0].text;
      console.log("Task analysis:", taskAnalysis);

      // Use the task analysis to query for relevant tools
      const relevantAntTools = await this.registry.queryTools(taskAnalysis, 3);

      // Convert AntTools to Tools format compatible with Anthropic API
      const relevantTools: Tool[] = relevantAntTools.map((tool: AntTool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });

      console.log(
        "Selected relevant tools:",
        relevantTools.map((t) => t.name).join(", "),
      );
      return relevantTools;
    } catch (error) {
      console.error("Error identifying required tools:", error);
      return [];
    }
  }

  async processQuery(query: string) {
    try {
      // Step 1: Identify tasks and required tools
      const relevantTools = await this.identifyRequiredTools(query);

      // If no relevant tools found, fallback to all available tools
      const toolsToUse =
        relevantTools.length > 0 ? relevantTools : this.availableTools;

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
        tools: toolsToUse,
      });

      const finalText: string[] = [];
      const toolCalls: { name: string; input: any; output: any }[] = [];

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
            const clientIndex = this.clientLookup.get(toolName);
            if (clientIndex === undefined) {
              throw new Error(`No client registered for tool ${toolName}`);
            }
            const result = await this.mcpClients[clientIndex]?.callTool({
              name: toolName,
              arguments: toolArgs,
            });
            if (result === undefined) {
              throw new Error(`Client failed to handle tool ${toolName}`);
            }

            // Record tool call for memory
            toolCalls.push({
              name: toolName,
              input: toolArgs,
              output: result.content,
            });

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
              content: result.content as string,
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
    await Promise.all(this.mcpClients.map((client) => client.close()));
  }
}
