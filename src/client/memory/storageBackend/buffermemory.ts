import type { StorageBackend } from "./storage";
import { type Conversation } from "../../../shared/messages/messages";

export class InMemoryStorageBackend implements StorageBackend {
  private conversation: Conversation = [];

  // Save a conversation to storage
  async saveConversation(conversation: Conversation): Promise<void> {
    // Save conversation to our local array
    this.conversation.push(...conversation);
  }

  // Retrieve conversations with pagination
  async getConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Conversation> {
    const offset = options?.offset || 0;
    const limit = options?.limit || this.conversation.length;

    return this.conversation.slice(offset, offset + limit);
  }

  // Clear all conversations
  async clear(): Promise<void> {
    this.conversation = [];
  }

  // Close the storage backend
  async close(): Promise<void> {
    this.conversation = [];
  }
}
