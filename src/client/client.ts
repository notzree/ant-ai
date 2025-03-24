import readline from "readline/promises";
import { ToolStore } from "./toolbox/toolbox";
import { type ConnectionOptions } from "../shared/connector/connector";
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
  ExceptionBlock,
} from "../shared/messages/messages";
import type { Memory } from "./memory/memory";
import WebSocket from "ws";
import { WebSocketClientTransport } from "../shared/connector/webSocketClientTransport";

const ANT_VERSION = process.env.ANT_VERSION || "1.0.0";
const MAX_RECURSION_DEPTH = 10; // Maximum number of re-evaluations

export class AntClient {
  private memory: Memory;
  private toolStore: ToolStore;
  private agent: Agent;
  private logFile: string;
  private logStream: fs.WriteStream;
  private wsClient: WebSocket | null = null; // ws connection

  constructor(agent: Agent, rc: RegistryClient, mem: Memory) {
    this.agent = agent;
    this.memory = mem;
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

  async connectToServer(url: string, type: "sse" | "stdio" | "websocket") {
    const opts: ConnectionOptions = {
      type: type,
      url: url,
      appName: "ant",
      appVersion: ANT_VERSION,
    };
    try {
      this.log(`Connecting to MCP server at ${url}`);
      if (type === "websocket") { // connecting to ws
        this.connectToWebSocket(url);
      } else {
        this.toolStore.connectToServer(opts);
      }
      this.log(`Successfully connected to MCP server at ${url}`);
    } catch (e) {
      const errorMsg = `Failed to connect to MCP server ${url}: ${e}`;
      this.log(errorMsg);
      console.log(errorMsg);
      throw e;
    }
  }

  private connectToWebSocket(url: string) {
    const transport = new WebSocketClientTransport(new URL(url));
  
    transport.onopen = () => {
      this.log(`WebSocket connection opened to ${url}`);
    };
  
    transport.onmessage = (message) => {
      this.log(`Received message: ${JSON.stringify(message)}`);
      // Handle incoming messages
    };
  
    transport.onerror = (error) => {
      this.log(`WebSocket error: ${error}`);
    };
  
    transport.onclose = () => {
      this.log(`WebSocket connection closed`);
    };
  
    transport.start().catch((error) => {
      this.log(`Failed to start WebSocket transport: ${error}`);
    });
  }

  /**
   * Process a user query, potentially recursively if new tools are discovered
   * @param query The user's query
   * @param recursionDepth Current recursion depth (default: 0)
   * @param messages Previous conversation messages (optional)
   * @returns The final response after all processing stages
   */
  async processQuery(
    query: string,
    recursionDepth: number = 0,
    messages: Conversation = [],
  ): Promise<Conversation> {
    var processedMessages: Message = new Message(MessageRole.ASSISTANT, []);
    try {
      this.log(
        `Processing query at recursion depth ${recursionDepth}: ${query}`,
      );

      // Stop if we've reached max recursion depth
      if (recursionDepth >= MAX_RECURSION_DEPTH) {
        const depthMessage = `[Maximum re-evaluation depth reached (${MAX_RECURSION_DEPTH}). Finalizing response.]`;
        this.log(depthMessage);
        messages[-1]?.addContent(new TextBlock(depthMessage, true));
        return messages;
      }

      // Prepare conversation messages
      if (recursionDepth === 0) {
        messages = await this.memory.load();
        messages.push(
          new Message(MessageRole.USER, [new TextBlock(query, true)]),
        );
        this.log(`Added user query to chat history: ${query}`);
      } else {
        // For recursion: use prev messages and add re-evaluation instruction
        const reEvalPrompt = `New messages have been added since your last response. There could be new context, or tools that have been added. Please re-evaluate the original query with your expanded knowledge set. (recursion level: ${recursionDepth}): "${query}"`;
        messages.push(
          new Message(MessageRole.USER, [new TextBlock(reEvalPrompt, false)]),
        );
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
              processedMessages.addContent(toolUseBlock);
              this.log(toolUseBlock.toString());
              const toolResultBlock =
                await this.toolStore.executeTool(toolUseBlock);
              //tool result block must be in a user message
              const toolMessage = new Message(MessageRole.USER, [
                toolResultBlock,
              ]);
              messages = messages.concat(processedMessages);
              messages = messages.concat(toolMessage);
              processedMessages = new Message(MessageRole.ASSISTANT, []);
            } catch (error) {
              processedMessages.addContent(new ExceptionBlock(error as string));
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
            return messages.concat(processedMessages);
            processedMessages.addContent(content);
          } else if (content.type === ContentBlockType.THINKING) {
            processedMessages.addContent(content);
          } else if (content.type === ContentBlockType.FINAL_RESPONSE) {
            const finalResponseBlock = content as FinalResponseBlock;
            processedMessages.addContent(finalResponseBlock);
            // nothing left to do if final response
            return messages.concat(processedMessages);
          }
        }
      }
      // if we havent exited here, then its time to recursively call again
      if (processedMessages.content.length > 0) {
        messages = messages.concat(processedMessages);
      }
      return this.processQuery(query, recursionDepth + 1, messages);
    } catch (error: any) {
      const errorMsg = `Error processing query (recursion depth ${recursionDepth}): ${error.message || 'Unknown error'}`;
      this.log(errorMsg);
      if (processedMessages.content.length > 0) {
        messages = messages.concat(processedMessages);
      }
      return messages.concat(
        new Message(MessageRole.SYSTEM, [new ExceptionBlock(errorMsg)]),
      );
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

        const conversationMessages = await this.processQuery(message);
        // Extract user-facing content for display
        let userResponse = "";
        for (const message of conversationMessages) {
          if (message.role === MessageRole.SYSTEM) {
            userResponse += `System message: \n`;
          }
          for (const block of message.content) {
            console.warn(block.userFacing, block.type);
            if (block.userFacing) {
              if (block.type === ContentBlockType.TEXT) {
                userResponse += (block as TextBlock).text + "\n";
              } else if (block.type === ContentBlockType.FINAL_RESPONSE) {
                userResponse += (block as FinalResponseBlock).response + "\n";
              } else if (block.type === ContentBlockType.TOOL_USE) {
                userResponse += `Calling...${(block as ToolUseBlock).name + "\n"}`;
              } else if (block.type === ContentBlockType.EXCEPTION) {
                userResponse += `Error: ${(block as ExceptionBlock).message + "\n"}`;
              }
              // Handle other user-facing block types as needed
            }
          }
        }

        // Log full conversation but show clean response to user
        this.log(`${JSON.stringify(conversationMessages)}`);
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
    if (this.wsClient) {
      this.wsClient.close();
    }
  }
}
