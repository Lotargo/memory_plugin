import * as z from "zod/v4";
import { manageSnapshots } from "../admin/cloud_snapshots.js";

export const SNAPSHOT_DESCRIPTION = "Manage full ZIP checkpoints of ALL local memory projects. Cloud uploads write one immutable BLOB row; no live mirroring. Actions: status, enable (backs up legacy local/cloud state before switching), configure (manual/scheduled/off, arbitrary hours), create (local only), upload, list (metadata only), restore (exact replacement), delete (half-open epoch-millisecond period), pin. Restore/delete return a preview and confirmToken; apply only by passing that token after the user approves the preview. No automatic cloud bootstrap.";
export const SNAPSHOT_PROPERTIES = {
  action: { type: "string", enum: ["status", "enable", "configure", "create", "upload", "list", "restore", "delete", "pin"] },
  location: { type: "string", enum: ["local", "cloud", "both"], description: "both is supported only for delete; default local" },
  id: { type: "string", description: "Selected checkpoint ID" },
  syncMode: { type: "string", enum: ["manual", "scheduled", "off"] },
  intervalHours: { type: "number", description: "Arbitrary positive hours, e.g. 0.5 or 168" },
  limit: { type: "integer", minimum: 1, maximum: 1000 },
  before: { type: "integer", description: "List entries before this epoch-millisecond timestamp" },
  from: { type: "integer", description: "Delete interval start (inclusive), default 0" },
  to: { type: "integer", description: "Delete interval end (exclusive)" },
  includeProtected: { type: "boolean", description: "Also delete pinned/latest/pending snapshots; default false" },
  confirmToken: { type: "string", description: "Token from an approved fresh restore/delete preview" },
  pinned: { type: "boolean" },
  force: { type: "boolean", description: "Force a new local checkpoint or resend unchanged state" },
};
export function registerSnapshotTools(server) {
  server.registerTool("manage_snapshots", {
    description: SNAPSHOT_DESCRIPTION,
    inputSchema: z.object({
      action: z.enum(SNAPSHOT_PROPERTIES.action.enum),
      location: z.enum(["local", "cloud", "both"]).optional(), id: z.string().optional(),
      syncMode: z.enum(["manual", "scheduled", "off"]).optional(), intervalHours: z.number().positive().optional(),
      limit: z.number().int().min(1).max(1000).optional(), before: z.number().int().optional(),
      from: z.number().int().nonnegative().optional(), to: z.number().int().positive().optional(),
      includeProtected: z.boolean().optional(), confirmToken: z.string().optional(),
      pinned: z.boolean().optional(), force: z.boolean().optional(),
    }).strict(),
  }, async args => {
    try { return { content: [{ type: "text", text: JSON.stringify(await manageSnapshots(args), null, 2) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text", text: error.message }] }; }
  });
}
