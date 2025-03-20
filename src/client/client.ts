import readline from "readline/promises";
import { BufferMemory } from "langchain/memory";
import { ToolStore } from "./toolbox/toolbox";
import { type ConnectionOptions } from "../shared/connector/connector";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { RegistryClient } from "../registry/registryClient";
import fs from "fs";
import path from "path";
import type { Agent } from "./agent/agent";
import {
  ContentBlockType,
  Message,
  MessageRole,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  UserInputBlock,
  FinalResponseBlock,
  type Conversation,
} from "../shared/messages/messages";

const ANT_VERSION = process.env.ANT_VERSION || "1.0.0";
const MAX_RECURSION_DEPTH = 10; // Maximum number of re-evaluations

export class AntClient {
  private memory: BufferMemory;
  private toolStore: ToolStore;
  private agent: Agent;
  private chatHistory: BaseMessage[] = [];
  private logFile: string;
  private logStream: fs.WriteStream;

  constructor(agent: Agent, rc: RegistryClient) {
    this.agent = agent;
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
   * Process a user query, potentially recursively if new tools are discovered
   * @param query The user's query
   * @param recursionDepth Current recursion depth (default: 0)
   * @param previousMessages Previous conversation messages (optional)
   * @returns The final response after all processing stages
   */
  async processQuery(
    query: string,
    recursionDepth: number = 0,
    previousMessages: Conversation = [],
  ): Promise<Conversation> {
    try {
      this.log(
        `Processing query at recursion depth ${recursionDepth}: ${query}`,
      );

      // Stop if we've reached max recursion depth
      if (recursionDepth >= MAX_RECURSION_DEPTH) {
        const depthMessage = `[Maximum re-evaluation depth reached (${MAX_RECURSION_DEPTH}). Finalizing response.]`;
        this.log(depthMessage);
        previousMessages[-1]?.addContent(new TextBlock(depthMessage, true));
        return previousMessages;
      }

      // Prepare conversation messages
      let messages: Conversation;
      if (recursionDepth === 0) {
        // Initial execution: load from memory and create messages
        const memoryResult = await this.memory.loadMemoryVariables({});
        const chatHistoryMessages = memoryResult.chat_history || [];

        // Convert chat history to Conversation / Message format
        messages = [
          ...chatHistoryMessages.map((msg: BaseMessage) => ({
            role: msg.getType() === "human" ? "user" : "assistant",
            content: msg.content,
          })),
          new Message(MessageRole.USER, [new TextBlock(query, true)]),
        ];

        // Add the user's query to chat history on first execution only
        this.chatHistory.push(new HumanMessage(query));
        this.log(`Added user query to chat history: ${query}`);
      } else {
        // For recursion: use provided messages and add re-evaluation instruction
        const reEvalPrompt = `New messages have been added since your last response. There could be new context, or tools that have been added. Please re-evaluate the original query with your expanded knowledge set. (recursion level: ${recursionDepth}): "${query}"`;
        messages = [
          ...previousMessages,
          new Message(MessageRole.USER, [new TextBlock(reEvalPrompt, false)]),
        ];
      }

      // Get current available tools count
      const initialToolCount = this.toolStore.getAvailableTools().length;
      // Log recursion level and tool status
      const levelPrefix =
        recursionDepth > 0 ? `[Re-evaluation ${recursionDepth}] ` : "";
      const toolsMessage = `${levelPrefix}Processing with ${initialToolCount} available tools`;
      this.log(toolsMessage);

      // Call chat method with messages and available tools
      const newMessages = await this.agent.chat(
        messages,
        this.toolStore.getAvailableTools(),
      );

      const processedMessages: Message = new Message(MessageRole.ASSISTANT, []);
      for (const message of newMessages) {
        if (message.role != MessageRole.ASSISTANT) {
          this.log(
            `Skipping processing message from ${message.role}: ${message.content}`,
          );
          continue;
        }
        for (const content of message.content) {
          if (content.type === ContentBlockType.TEXT) {
            processedMessages.addContent(content);
          } else if (content.type === ContentBlockType.TOOL_USE) {
            try {
              const toolUseBlock = content as ToolUseBlock;
              const resultBlock =
                await this.toolStore.executeTool(toolUseBlock);
              processedMessages.addContent(resultBlock);
            } catch (error) {
              //todo: figure out informing LLM that tool call failed later
              console.error(`Error executing tool: ${error}`);
              continue;
            }
          } else if (content.type === ContentBlockType.TOOL_RESULT) {
            processedMessages.addContent(content);
          } else if (content.type === ContentBlockType.USER_INPUT) {
            //TODO: figure out if this needs any special processing
            // as of march 19th: deciding to return early so the calling class can show this to the user.
            // what happens if there are more blocks after this? (tbh idt this will happen but should handle the case)
            const userInputBlock = content as UserInputBlock;
            processedMessages.addContent(content);
            return previousMessages.concat(processedMessages);
            processedMessages.addContent(content);
          } else if (content.type === ContentBlockType.THINKING) {
            processedMessages.addContent(content);
          } else if (content.type === ContentBlockType.FINAL_RESPONSE) {
            const finalResponseBlock = content as FinalResponseBlock;
            processedMessages.addContent(finalResponseBlock);
            // nothing left to do if final response
            return previousMessages.concat(processedMessages);
          }
        }
      }
      // if we havent exited here, then its time to recursively call again
      return this.processQuery(
        query,
        recursionDepth + 1,
        previousMessages.concat(processedMessages),
      );
    } catch (error) {
      //TODO: Improve error handling here, need to add an errorblock.
      const errorMsg = `Error processing query (recursion depth ${recursionDepth}): ${error?.message}`;
      console.error(errorMsg);
      this.log(errorMsg);
      return previousMessages;
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

        // Process the query with new implementation
        const conversationMessages = await this.processQuery(message);

        // Extract user-facing content for display
        let userResponse = "";
        for (const message of conversationMessages) {
          if (message.role === MessageRole.ASSISTANT) {
            for (const block of message.content) {
              if (block.userFacing) {
                if (block.type === ContentBlockType.TEXT) {
                  userResponse += (block as TextBlock).text + "\n";
                } else if (block.type === ContentBlockType.FINAL_RESPONSE) {
                  userResponse += (block as FinalResponseBlock).response + "\n";
                }
                // Handle other user-facing block types as needed
              }
            }
          }
        }

        // Log full conversation but show clean response to user
        this.log(`Full conversation: ${JSON.stringify(conversationMessages)}`);
        console.log("\n" + userResponse.trim());

        // TODO: Save to memory when implemented
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
