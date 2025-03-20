import type { Conversation } from "../../shared/messages/messages";
import type { StorageBackend } from "./storageBackend/storage";

export class Memory {
  // can add memory compaction here.
  // will significantly differ once we change ui/ux from chat -> notion-esque thing.
  backend: StorageBackend;
  constructor(backend: StorageBackend) {
    this.backend = backend;
  }

  async save(conversation: Conversation): Promise<void> {
    await this.backend.saveConversation(conversation);
  }

  /*
  Load conversations from memory with an optional limit + offset from the top
  */
  async load(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Conversation> {
    return await this.backend.getConversations(options);
  }

  async clear(): Promise<void> {
    await this.backend.clear();
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}
