import { Anthropic } from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import type {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import readline from "readline/promises";
import { ConversationChain } from "langchain/chains";
import { BufferMemory } from "langchain/memory";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  Connector,
  type ConnectionOptions,
} from "../shared/connector/connector";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  AIMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}
const ANT_VERSION = process.env.ANT_VERSION || "1.0.0";

export class AntClient {
  private memory: BufferMemory;
  private anthropic: Anthropic;
  private model: ChatAnthropic;
  private mcp: Client;
  private transport: Transport | null = null;
  private tools: Tool[] = [];
  private chatHistory: BaseMessage[] = [];
  private connector: Connector = new Connector();

  constructor() {
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.model = new ChatAnthropic({
      anthropicApiKey: ANTHROPIC_API_KEY,
      modelName: "claude-3-5-sonnet-20241022",
      temperature: 0.7,
    });

    this.memory = new BufferMemory({
      memoryKey: "chat_history",
      returnMessages: true,
    });

    this.mcp = new Client({ name: "ant-client", version: ANT_VERSION });
  }

  async connectToServer(serverScriptPath: string) {
    const opts: ConnectionOptions = {
      type: "sse",
      url: serverScriptPath,
      appName: "ant",
      appVersion: "1.0.0",
    };
    try {
      this.mcp = await this.connector.connect(opts);
      const toolsResult = await this.mcp.listTools();

      // Convert MCP tools to LangChain compatible format
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });

      console.log(
        "Connected to server with tools:",
        this.tools.map(({ name }) => name),
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
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

      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        messages,
        tools: this.tools,
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

          finalText.push(
            `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
          );
          const result = await this.mcp.callTool({
            name: toolName,
            arguments: toolArgs,
          });

          // Record tool call for memory
          toolCalls.push({
            name: toolName,
            input: toolArgs,
            output: result.content,
          });

          // Add tool result as user message (following Claude's expected format)
          messages.push({
            role: "user",
            content: result.content as string,
          });

          // Get response to tool result
          const toolResponse = await this.anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            messages,
          });

          if (toolResponse && toolResponse.content.length > 0) {
            const toolResponseText =
              toolResponse.content[0].type === "text"
                ? toolResponse.content[0].text
                : "";
            finalText.push(toolResponseText);
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
    await this.mcp.close();
  }
}
