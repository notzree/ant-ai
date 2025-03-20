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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
}

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
  text: string | any;

  constructor(
    text: string | any,
    userFacing: boolean,
    metadata: Record<string, unknown> = {},
  ) {
    super(ContentBlockType.TEXT, userFacing, metadata);
    this.text = text;
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
      {
        cache_control: content.cache_control,
      },
      content.is_error || false,
    );
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
}

export class FinalResponseBlock extends BaseContentBlock {
  response: string;
  constructor(response: string, metadata: Record<string, unknown> = {}) {
    super(ContentBlockType.FINAL_RESPONSE, true, metadata);
    this.response = response;
  }
  toAnthropic(): ContentBlockParam {
    return {
      type: "text",
      text: this.response,
      cache_control:
        (this.metadata.cache_control as CacheControlEphemeral) || null,
      citations: this.metadata.citations as TextCitationParam[],
    };
  }
  static fromAnthropic(block: TextBlockParam): FinalResponseBlock {
    return new FinalResponseBlock(block.text, {
      cache_control: block.cache_control,
      citations: block.citations,
    });
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
  | FinalResponseBlock;
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
}

// export interface Message {
//   id: string;
//   role: MessageRole;
//   content: ContentBlock[];
//   createdAt: string;
//   metadata?: Record<string, unknown>;

//   // Add a method to the interface
//   toAnthropic(): AnthropicMessage;
// }

// // Implementation of Message as a class
// export class MessageImpl implements Message {
//   id: string;
//   role: MessageRole;
//   content: ContentBlock[];
//   createdAt: string;
//   metadata?: Record<string, unknown>;

//   constructor(
//     id: string,
//     role: MessageRole,
//     content: ContentBlock[],
//     createdAt: string,
//     metadata?: Record<string, unknown>,
//   ) {
//     this.id = id;
//     this.role = role;
//     this.content = content;
//     this.createdAt = createdAt;
//     this.metadata = metadata;
//   }

//   toAnthropic(): AnthropicMessage {
//     return {
//       role: this.role,
//       content: this.content.map((block) => block.toAnthropic()),
//       // Add any other fields needed for Anthropic's message format
//     };
//   }
// }

// export function fromAnthropicMessage(message: AnthropicMessage): Message {
//   // Implementation would depend on Anthropic's message format
//   // This is a placeholder
//   const content: ContentBlock[] = message.content.map((block) => {
//     switch (block.type) {
//       case ContentBlockType.TEXT:
//         return new TextBlock(
//           block.text as string,
//           new Date().toISOString(),
//           true,
//         );
//       // Handle other block types similarly
//       default:
//         throw new Error(`Unsupported content block type: ${block.type}`);
//     }
//   });

//   return new MessageImpl(
//     crypto.randomUUID(), // Generate an ID
//     message.role as MessageRole,
//     content,
//     new Date().toISOString(),
//   );
// }

// // Helper to convert to Anthropic message format - simplified version
// export function toAnthropicMessage(message: Message): AnthropicMessage {
//   return message.toAnthropic();
// }
