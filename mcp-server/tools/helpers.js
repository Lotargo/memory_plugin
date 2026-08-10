import * as z from "zod/v4";
import { factMeta, factText } from "../fact_format.js";

// Optional string/number that tolerates null (some tool-call layers fill omitted
// optional args with null). Linking fields must NEVER be mandatory.
export const optStr = () => z.string().optional().nullable();
// Tolerates "" and numeric strings: some tool-call layers send empty strings for
// omitted numeric args, which plain z.number() rejects with "Expected number".
export const optNum = () =>
  z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    });
export const defStr = (fallback) =>
  z
    .string()
    .nullish()
    .transform((v) => (v === null || v === undefined || v === "" ? fallback : v));
export const defBool = (fallback) =>
  z.boolean().nullish().transform((v) => (v === null || v === undefined ? fallback : v));
export const defNum = (fallback) =>
  z
    .union([z.number(), z.string(), z.null()])
    .nullish()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return fallback;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : fallback;
    });

// Project memory is git-based: outside a git repository there is no project key.
export function requireProjectKey(key) {
  if (!key) {
    throw new Error(
      "No project memory available: this directory is not inside a git repository. " +
        "Project memory is tied to a git repo; use scope: 'global' or open a git repository."
    );
  }
  return key;
}

// Resolve a fact reference (1-based number, metadata id, or text) to an index.
export function resolveFactIndex(entries, ref) {
  const trimmed = String(ref || "").trim();
  if (!trimmed) return -1;
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (num >= 1 && num <= entries.length) return num - 1;
  }
  const idIdx = entries.findIndex((e) => factMeta(e).id === trimmed);
  if (idIdx !== -1) return idIdx;
  const textIdx = entries.findIndex((e) => factText(e).toLowerCase().includes(trimmed.toLowerCase()));
  return textIdx;
}
