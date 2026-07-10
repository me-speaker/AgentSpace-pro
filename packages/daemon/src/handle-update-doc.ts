// FSM P2-2 — Handler for "update-doc" task type.
//
// Writes the given `content` to a workspace-scoped file under
// `.data/docs/<workspaceId>-<docId>.<format>` relative to the test
// repo's data directory. Real production would go through Postgres
// + S3 (per the prod services layer); in the sandbox we just append
// to a per-workspace directory so the output is observable and
// e2e-pipeline smoke-testable without external infrastructure.
//
// Validation:
//   - workspaceId  required
//   - docId        required (non-empty)
//   - content      required (string)
//   - format       one of "json" | "text" | "markdown" (default "json")
//
// Returns the bytes written and the absolute (or relative-to-cwd)
// path so callers can include it in FSM context for downstream steps.

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskInput } from "./task-types.ts";

export interface UpdateDocResult {
  bytesWritten: number;
  /** Path where the doc was written. May be relative to cwd. */
  path: string;
  format: "json" | "text" | "markdown";
}

const VALID_FORMATS: ReadonlyArray<"json" | "text" | "markdown"> = [
  "json",
  "text",
  "markdown",
];

export function handleUpdateDoc(input: TaskInput): UpdateDocResult {
  if (!input.workspaceId) {
    throw new Error("update-doc task: workspaceId required");
  }
  if (!input.docId || input.docId.trim().length === 0) {
    throw new Error("update-doc task: docId required");
  }
  if (typeof input.content !== "string") {
    throw new Error("update-doc task: content (string) required");
  }
  const format = input.format ?? "json";
  if (!VALID_FORMATS.includes(format)) {
    throw new Error(
      `update-doc task: invalid format "${input.format}" (must be one of ${VALID_FORMATS.join("|")})`,
    );
  }

  // Sanitize docId against path traversal — only [A-Za-z0-9._-] allowed.
  if (!/^[A-Za-z0-9._-]+$/.test(input.docId)) {
    throw new Error(
      `update-doc task: invalid docId "${input.docId}" (only [A-Za-z0-9._-] allowed)`,
    );
  }

  const dir = path.join(".data", "docs", input.workspaceId);
  const filename = `${input.docId}.${format === "markdown" ? "md" : format}`;
  const filePath = path.join(dir, filename);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, input.content, "utf8");
  const bytesWritten = Buffer.byteLength(input.content, "utf8");

  return { bytesWritten, path: filePath, format };
}
