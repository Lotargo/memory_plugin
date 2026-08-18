import { registerMemoryTools } from "./memory_tools.js";
import { registerIdentityTools } from "./identity_tools.js";
import { registerRagTools } from "./rag_tools.js";
import { registerNoteTools } from "./note_tools.js";

export function registerAllTools(server) {
  registerMemoryTools(server);
  registerIdentityTools(server);
  registerRagTools(server);
  registerNoteTools(server);
}
