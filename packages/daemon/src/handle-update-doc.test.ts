// FSM P2-2 — Unit tests for "update-doc" handler.
//
// Run with:
//   node --experimental-strip-types --test packages/daemon/src/handle-update-doc.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { handleUpdateDoc } from "./handle-update-doc.ts";

test.beforeEach(() => {
  // Clean .data/docs between tests so each test owns its own file.
  const docs = path.join(".data", "docs");
  if (fs.existsSync(docs)) {
    fs.rmSync(docs, { recursive: true, force: true });
  }
});

test.after(() => {
  const docs = path.join(".data", "docs");
  if (fs.existsSync(docs)) {
    fs.rmSync(docs, { recursive: true, force: true });
  }
});

test("handleUpdateDoc: writes JSON content + reports byte count + path", () => {
  const result = handleUpdateDoc({
    workspaceId: "ws_doc1",
    taskType: "update-doc",
    docId: "thesis-36page",
    content: '{"hello":"world"}',
    format: "json",
  });

  assert.equal(result.bytesWritten, 17);
  assert.equal(result.format, "json");
  // path should be relative to cwd and end with the docId
  assert.ok(
    result.path.endsWith("thesis-36page.json"),
    `unexpected path: ${result.path}`,
  );
  // file actually exists with content
  const onDisk = fs.readFileSync(result.path, "utf8");
  assert.equal(onDisk, '{"hello":"world"}');
});

test("handleUpdateDoc: text format writes .text extension", () => {
  const result = handleUpdateDoc({
    workspaceId: "ws_doc2",
    taskType: "update-doc",
    docId: "greeting",
    content: "hello world",
    format: "text",
  });
  assert.equal(result.format, "text");
  assert.ok(result.path.endsWith("greeting.text"));
  assert.equal(fs.readFileSync(result.path, "utf8"), "hello world");
});

test("handleUpdateDoc: markdown format writes .md extension", () => {
  const result = handleUpdateDoc({
    workspaceId: "ws_doc3",
    taskType: "update-doc",
    docId: "todo",
    content: "# Heading\n\n- item",
    format: "markdown",
  });
  assert.equal(result.format, "markdown");
  assert.ok(result.path.endsWith("todo.md"));
});

test("handleUpdateDoc: defaults format to json when omitted", () => {
  const result = handleUpdateDoc({
    workspaceId: "ws_doc4",
    taskType: "update-doc",
    docId: "doc-no-fmt",
    content: "{}",
  });
  assert.equal(result.format, "json");
  assert.ok(result.path.endsWith("doc-no-fmt.json"));
});

test("handleUpdateDoc: rejects missing workspaceId", () => {
  assert.throws(
    () =>
      handleUpdateDoc({
        // @ts-expect-error — testing runtime validation
        workspaceId: "",
        taskType: "update-doc",
        docId: "x",
        content: "y",
      }),
    /workspaceId required/,
  );
});

test("handleUpdateDoc: rejects missing docId", () => {
  assert.throws(
    () =>
      handleUpdateDoc({
        workspaceId: "ws",
        taskType: "update-doc",
        // @ts-expect-error
        docId: "",
        content: "y",
      }),
    /docId required/,
  );
});

test("handleUpdateDoc: rejects non-string content", () => {
  assert.throws(
    () =>
      handleUpdateDoc({
        workspaceId: "ws",
        taskType: "update-doc",
        docId: "x",
        // @ts-expect-error
        content: 42,
      }),
    /content \(string\) required/,
  );
});

test("handleUpdateDoc: rejects invalid format", () => {
  assert.throws(
    () =>
      handleUpdateDoc({
        workspaceId: "ws",
        taskType: "update-doc",
        docId: "x",
        content: "y",
        // @ts-expect-error
        format: "pdf",
      }),
    /invalid format "pdf"/,
  );
});

test("handleUpdateDoc: rejects path-traversal docId", () => {
  assert.throws(
    () =>
      handleUpdateDoc({
        workspaceId: "ws",
        taskType: "update-doc",
        docId: "../../etc/passwd",
        content: "evil",
      }),
    /invalid docId/,
  );
});
