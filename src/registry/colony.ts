// import type { AntTool } from "../shared/tools/tool";
// import type { Registry } from "./registry";

// export class Colony implements Registry {
//   private storer Storer;
//   private vectorStorer VectorStorer;
//   queryTools(query: string, limit?: number): Promise<AntTool[]> {

//   }
//   addTool(tool: AntTool): Promise<AntTool> {

//   }
//   listTools(): Promise<AntTool[]> {

//   }
//   deleteTool(id: string): Promise<boolean> {

//   }
// }

// // What does colony need?
// // colony needs to:
// // needs a vectordb vectorStorer
// // needs a normal db storer (what db should this be)
// // needs a method to ingest tools from an mcp server (needs connector)
// // vector store maps description semantics -> server id
// // do we even need a normal db store probably not tbh
// // access patterns mostly going to be from the vector store
// // maybe also an inverted index for lookingup api integrations.
// //

// export type ColonyQueryRequest = {
//   query: string;
//   limit?: number;
// };
