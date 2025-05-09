import type {
  MessageParam,
  TextBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
  ContentBlockParam,
  TextCitationParam,
  Message as AnthropicMessage,
  CacheControlEphemeral,
  ThinkingBlockParam,
} from "@anthropic-ai/sdk/src/resources/index.js";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

export type Conversation = Array<Message>;

export class Message {
  content: Array<ContentBlock>;
  role: MessageRole;

  constructor(role: MessageRole, content: Array<ContentBlock> = []) {
    this.content = content;
    this.role = role;
  }

  addContent(content: ContentBlock) {
    this.content.push(content);
  }

  toAnthropicMessageParam(): MessageParam {
    const anthropicRole =
      this.role === MessageRole.ASSISTANT ? "assistant" : "user";
    return {
      content: this.content.map((block) => block.toAnthropic()),
      role: anthropicRole,
    };
  }
  static fromAnthropicMessage(message: AnthropicMessage): Message {
    const content = message.content.map((content) => {
      if (content.type === "text") {
        if (content.text.includes(ContentBlockType.USER_INPUT.valueOf())) {
          // if text block includes request for user input
          return UserInputBlock.fromAnthropic(content);
        }
        if (content.text.includes(ContentBlockType.FINAL_RESPONSE.valueOf())) {
          // if text block includes final answer identifier.
          return FinalResponseBlock.fromAnthropic(content);
        }
        return TextBlock.fromAnthropic(content);
      } else if (content.type === "tool_use") {
        return ToolUseBlock.fromAnthropic(content);
      } else if (content.type === "thinking") {
        // combine thinking and text blocks for now
        return ThinkingBlock.fromAnthropic(content);
      }
      throw new Error(`Unknown content type: ${content.type}`);
    });
    return new Message(
      message.role === "assistant" ? MessageRole.ASSISTANT : MessageRole.USER,
      content,
    );
  }
  toStrings(): string[] {
    return this.content.map((block) => block.toString());
  }
  toLangChainMem(): HumanMessage | AIMessage {
    if (this.role === MessageRole.ASSISTANT) {
      return new AIMessage(this.toStrings().join("\n"));
    } else {
      return new HumanMessage(this.toStrings().join("\n"));
    }
  }
}

// Union type for all content block classes
// TODO: Add: Image / Media block, Add ThinkingBlock (potentially)
//
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | UserInputBlock
  | FinalResponseBlock
  | ExceptionBlock;

// Abstract base class for all content blocks
export abstract class BaseContentBlock {
  type: ContentBlockType;
  userFacing: boolean;
  metadata: Record<string, unknown>;

  constructor(
    type: ContentBlockType,
    userFacing: boolean,
    metadata: Record<string, unknown> = {},
  ) {
    this.type = type;
    this.userFacing = userFacing;
    this.metadata = metadata;
  }

  // Common method that all content blocks will implement
  abstract toAnthropic(): ContentBlockParam;
}

export class TextBlock extends BaseContentBlock {
  text: string;

  constructor(
    text: string | any,
    userFacing: boolean,
    metadata: Record<string, unknown> = {},
  ) {
    super(ContentBlockType.TEXT, userFacing, metadata);

    // Clean and sanitize the text
    this.text = this.sanitizeText(text);
  }

  /**
   * Sanitizes and cleans the input text by removing unnecessary formatting
   */
  private sanitizeText(text: any): string {
    // Convert to string if it's not already a string
    let textStr = typeof text === "string" ? text : JSON.stringify(text);

    // Clean up the text content to make it more readable
    textStr = this.cleanTextContent(textStr);

    return textStr;
  }

  /**
   * Cleans text content to make it more readable by removing excessive formatting
   */
  private cleanTextContent(text: string): string {
    // Skip cleaning if the text seems simple or clean already
    if (text.length < 100 && !text.includes("<") && !text.includes("\\")) {
      return text;
    }

    // Remove escaped backslashes (common in various exports)
    text = text.replace(/\\\\+/g, "\\");

    // Remove HTML tags
    text = text.replace(
      /<\/?(?:div|span|p|br|table|tr|td|th|b|i|strong|em|a|ul|ol|li|h\d)[^>]*>/gi,
      " ",
    );

    // Remove script and style tags and their contents
    text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, "");

    // Remove invisible characters and HTML entities
    text = text.replace(/(&zwnj;|&nbsp;|&#8203;|&#847;|&#160;)/g, " ");

    // Replace entities with their actual characters
    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Remove excessive whitespace
    text = text.replace(/\s{2,}/g, " ");

    // Remove excessive newlines
    text = text.replace(/\n{3,}/g, "\n\n");

    // Remove tracking codes, pixel markers, and hidden content
    text = text.replace(/\[\[.*?\]\]/g, "");
    text = text.replace(/\{\{.*?\}\}/g, "");

    // Clean up JSON-like structures that might be overly verbose
    text = text.replace(
      /"content":\s*\[\s*\{\s*"type":\s*"text",\s*"text":\s*("[^"]*"|\{[^\}]*\})/g,
      (match, p1) => {
        // Extract just the text content
        if (p1.startsWith('"')) {
          return p1.substring(1, p1.length - 1);
        }
        return p1;
      },
    );

    // Remove any leftover JSON format artifacts
    text = text.replace(/",\s*"/g, " ");
    text = text.replace(/"\s*}/g, "");
    text = text.replace(/{\s*"/g, "");

    // Handle escaped quotes
    text = text.replace(/\\"/g, '"');

    // Clean up unicode escape sequences
    text = text.replace(/\\u([0-9a-fA-F]{4})/g, (match, p1) => {
      return String.fromCharCode(parseInt(p1, 16));
    });

    return text.trim();
  }

  toAnthropic(): TextBlockParam {
    return {
      type: "text",
      text: this.text,
      cache_control:
        (this.metadata["cache_control"] as CacheControlEphemeral) || null,
      citations: (this.metadata["citations"] as Array<TextCitationParam>) || [],
    };
  }

  static fromAnthropic(content: TextBlockParam): TextBlock {
    return new TextBlock(content.text, true, {
      cache_control: content.cache_control,
      citations: content.citations,
    });
  }

  toString(): string {
    return this.text;
  }
}

export class ToolUseBlock extends BaseContentBlock {
  // id: a unique id generated when the model calls a tool (something related to MCP)
  // This may be claude specific, but maps tool calls to tool responses
  id: string;
  name: string;
  args: { [x: string]: unknown } | undefined;

  constructor(
    id: string,
    name: string,
    args: unknown,
    userFacing: boolean,
    metadata: Record<string, unknown> = {},
  ) {
    super(ContentBlockType.TOOL_USE, userFacing, metadata);
    this.id = id;
    this.name = name;

    if (
      args !== undefined &&
      (typeof args !== "object" || args === null || Array.isArray(args))
    ) {
      throw new Error("Invalid args: expected an object with key-value pairs.");
    }

    this.args = args as { [x: string]: unknown };
  }

  toAnthropic(): ToolUseBlockParam {
    return {
      type: "tool_use",
      id: this.id,
      name: this.name,
      input: this.args,
      cache_control:
        (this.metadata["cache_control"] as CacheControlEphemeral) || null,
    };
  }

  static fromAnthropic(content: ToolUseBlockParam): ToolUseBlock {
    //TODO: Figure out if we want to show user tool use block
    return new ToolUseBlock(content.id, content.name, content.input, true, {
      cache_control: content.cache_control,
    });
  }

  toString(): string {
    return `Tool Use: ${this.name} (ID: ${this.id}), Args: ${JSON.stringify(this.args)}`;
  }
}

export class ToolResultBlock extends BaseContentBlock {
  toolUseId: string;
  content: Array<TextBlock>; // TODO: Add Imageblock (we dont rly support images yet)
  isError: boolean;
  constructor(
    toolUseId: string,
    content: Array<TextBlock>,
    userFacing: boolean,
    isError: boolean,
    metadata: Record<string, unknown> = {},
  ) {
    super(ContentBlockType.TOOL_RESULT, userFacing, metadata);
    this.toolUseId = toolUseId;
    this.content = content;
    this.isError = isError;
  }

  toAnthropic(): ToolResultBlockParam {
    return {
      type: "tool_result",
      tool_use_id: this.toolUseId,
      content: this.content.map((block) => block.toAnthropic()),
      cache_control:
        (this.metadata["cache_control"] as CacheControlEphemeral) || null,
      is_error: this.isError,
    };
  }

  static fromAnthropic(content: ToolResultBlockParam): ToolResultBlock {
    let ourContent: Array<TextBlock>;
    if (!content.content || !Array.isArray(content.content)) {
      // If content is missing or not an array, return an appropriate TextBlock
      ourContent = [new TextBlock(content.content || "", true)];
      content.content = [];
    }
    ourContent = [];
    for (const block of content.content) {
      if (block.type == "image") {
        throw new Error("Image blocks are not supported yet as a ToolResult");
      } else {
        ourContent.push(TextBlock.fromAnthropic(block));
      }
    }
    return new ToolResultBlock(
      content.tool_use_id,
      ourContent,
      false,
      content.is_error || false,
      {
        cache_control: (content.cache_control as CacheControlEphemeral) || null,
      },
    );
  }

  toString(): string {
    const contentStr = this.content.map((block) => String(block)).join("\n");
    return `Tool Result (ID: ${this.toolUseId})${this.isError ? " [ERROR]" : ""}:\n${contentStr}`;
  }
  // Todo: If i can figure out mcp bum ahh typing we can implement
  // fromMCP function. Instead, its messy af inside the toolbox.ts right now.
}

export class ThinkingBlock extends BaseContentBlock {
  thinking: string;
  signature: string;
  constructor(signature: string, thinking: string) {
    super(ContentBlockType.THINKING, false);
    this.thinking = thinking;
    this.signature = signature;
  }

  toAnthropic(): ContentBlockParam {
    return {
      type: "thinking",
      thinking: this.thinking,
      signature: this.signature,
    };
  }

  static fromAnthropic(block: ThinkingBlockParam): ThinkingBlock {
    return new ThinkingBlock(block.signature, block.thinking);
  }

  toString(): string {
    return `Thinking (${this.signature}): ${this.thinking}`;
  }
}

export class UserInputBlock extends BaseContentBlock {
  request: string;
  constructor(request: string, metadata: Record<string, unknown> = {}) {
    super(ContentBlockType.USER_INPUT, true, metadata);
    this.request = request;
  }

  toAnthropic(): ContentBlockParam {
    return {
      type: "text",
      text: this.request,
      cache_control:
        (this.metadata.cache_control as CacheControlEphemeral) || null,
      citations: this.metadata.citations as TextCitationParam[],
    };
  }

  static fromAnthropic(block: TextBlockParam): UserInputBlock {
    let userRequest = "";
    const requestPattern = /NEED_USER_INPUT:?\s*(.+?)(?=\n\n|\n$|$)/s;
    const match = block.text.match(requestPattern);
    if (match && match[1]) {
      userRequest = match[1].trim();
    } else {
      userRequest = block.text.replace(/NEED_USER_INPUT:?/g, "").trim();
    }
    userRequest = "I need additional information to proceed." + userRequest;
    return new UserInputBlock(userRequest, {
      cache_control: block.cache_control,
      citations: block.citations,
    });
  }

  toString(): string {
    return this.request;
  }
}

export class FinalResponseBlock extends BaseContentBlock {
  response: string;
  constructor(response: string, metadata: Record<string, unknown> = {}) {
    super(ContentBlockType.FINAL_RESPONSE, true, metadata);
    this.response = response;
  }

  toAnthropic(): TextBlockParam {
    return {
      type: "text",
      text: this.response,
      cache_control:
        (this.metadata.cache_control as CacheControlEphemeral) || null,
      citations: this.metadata.citations as TextCitationParam[],
    };
  }

  static fromAnthropic(block: TextBlockParam): FinalResponseBlock {
    let finalResponse = "";
    const responsePattern = /FINAL_RESPONSE:?\s*(.+?)(?=\n\n|\n$|$)/s;
    const match = block.text.match(responsePattern);

    if (match && match[1]) {
      finalResponse = match[1].trim();
    } else {
      finalResponse = block.text.replace(/FINAL_RESPONSE:?/g, "").trim();
    }

    return new FinalResponseBlock(finalResponse, {
      cache_control: block.cache_control,
      citations: block.citations,
    });
  }

  toString(): string {
    return this.response;
  }
}

//TODO: consider adding different types of excpetins
//ie: exception from MCP server, exception from client, etc
export class ExceptionBlock extends BaseContentBlock {
  message: string;
  constructor(message: string, metadata: Record<string, unknown> = {}) {
    super(ContentBlockType.EXCEPTION, true, metadata);
    this.message = message;
  }

  toAnthropic(): TextBlockParam {
    return {
      type: "text",
      text: this.message,
      cache_control:
        (this.metadata.cache_control as CacheControlEphemeral) || null,
      citations: this.metadata.citations as TextCitationParam[],
    };
  }

  static fromAnthropic(block: TextBlockParam): ExceptionBlock {
    return new ExceptionBlock(block.text, {
      cache_control: block.cache_control,
      citations: block.citations,
    });
  }

  toString(): string {
    return `Exception: ${this.message}`;
  }
}

export enum MessageRole {
  SYSTEM = "system",
  USER = "user",
  ASSISTANT = "assistant",
}

export enum ContentBlockType {
  TEXT = "TEXT",
  USER_INPUT = "NEED_USER_INPUT",
  TOOL_USE = "TOOL_USE",
  TOOL_RESULT = "TOOL_RESULT",
  THINKING = "THINKING",
  FINAL_RESPONSE = "FINAL_RESPONSE",
  EXCEPTION = "EXCEPTION",
}
