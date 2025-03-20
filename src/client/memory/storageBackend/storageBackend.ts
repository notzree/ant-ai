import type { Conversation } from "../../../shared/messages/messages";

export interface StorageBackend {
  // Save conversations to storage
  saveConversation(message: Conversation): Promise<void>;

  // retrieve conversation from a given offset + limit
  getConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Conversation>;

  // clear all conversations from storage
  clear(): Promise<void>;

  // close the storage backend
  close(): Promise<void>;
}
