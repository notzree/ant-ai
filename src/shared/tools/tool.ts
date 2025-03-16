import type { User } from "../user/user";

export interface AntTool {
  id: string; // this might be server id or somehting
  name: string;
  description: string;
  baseServerUrl: string;
  getUrl(user: User): Promise<string>;
}
