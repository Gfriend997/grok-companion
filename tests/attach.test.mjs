import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateTokens, stripExif, toParts } from "../scripts/lib/attach.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-attach-"));
const file = (name) => path.join(dir, name);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("toParts identifies JPEG and PNG by magic bytes instead of extension", () => {
  fs.writeFileSync(file("photo.txt"), jpg);
  fs.writeFileSync(file("image.data"), png);
  const { parts } = toParts([file("photo.txt"), file("image.data")]);
  assert.equal(parts[0].image_url.url.slice(0, 15), "data:image/jpeg");
  assert.equal(parts[1].image_url.url.slice(0, 15), "data:image/png;");
});

test("toParts does not treat a mislabeled image extension as an image", () => {
  fs.writeFileSync(file("not-an-image.jpg"), "plain text");
  assert.equal(toParts([file("not-an-image.jpg")]).parts[0].type, "text");
});

test("toParts rejects oversized inputs before encoding", () => {
  fs.writeFileSync(file("large.png"), Buffer.concat([png, Buffer.alloc(10)]));
  assert.throws(() => toParts([file("large.png")], { maxFileBytes: 8 }), (error) => error.error_class === "usage");
});

test("stripExif removes JPEG APP segments", () => {
  const source = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, 0xff, 0xda, 0x00, 0x00]);
  assert.equal(stripExif(source, "jpg").includes(Buffer.from("Exif")), false);
});

test("estimateTokens returns a positive number for text and images", () => {
  assert.ok(estimateTokens([{ type: "text", text: "a".repeat(400) }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }]) >= 356);
});

test("toParts propagates secret preflight rejection", () => {
  fs.writeFileSync(file("secret.txt"), "x" + "ai-" + "z".repeat(32));
  assert.throws(() => toParts([file("secret.txt")]), (error) => error.error_class === "usage" && /secret/.test(error.message));
});

const REJECT = /attachment rejected: .* is a binary document; convert it to markdown first \(MarkItDown\) and attach the \.md/;

test("toParts rejects binary documents by upper-case extension", () => {
  fs.writeFileSync(file("REPORT.PDF"), "plain");
  assert.throws(() => toParts([file("REPORT.PDF")]), (e) => REJECT.test(e.message) && e.error_class === "usage");
});

test("toParts rejects binary documents by magic bytes despite a .txt extension", () => {
  const magics = {
    pdf: Buffer.from("%PDF-1.7\nabc"),
    zip: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
    ole: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]),
    rtf: Buffer.from("{\rtf1\ansi hello")
  };
  for (const [name, data] of Object.entries(magics)) {
    fs.writeFileSync(file(`${name}.txt`), data);
    assert.throws(() => toParts([file(`${name}.txt`)]), REJECT, name);
  }
});

test("toParts rejects a NUL byte in the first 8 KB", () => {
  fs.writeFileSync(file("blob.dat"), Buffer.concat([Buffer.from("text"), Buffer.from([0]), Buffer.from("more")]));
  assert.throws(() => toParts([file("blob.dat")]), REJECT);
});

test("toParts still passes normal text and code files", () => {
  fs.writeFileSync(file("code.ts"), "export const x = 1;\n");
  fs.writeFileSync(file("notes.txt"), "hello");
  assert.deepEqual(toParts([file("code.ts"), file("notes.txt")]).parts.map((p) => p.type), ["text", "text"]);
});
