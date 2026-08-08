import assert from "node:assert/strict";
import { test } from "node:test";
import { AdbError, extractPng } from "../src/adb.js";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("projector shell preamble is stripped from screenshots", () => {
  const image = Buffer.concat([signature, Buffer.from("image-data")]);
  const prefixed = Buffer.concat([Buffer.from("Init wrapper system mutex successful\n"), image]);
  assert.deepEqual(extractPng(prefixed), image);
  assert.deepEqual(extractPng(image), image);
});

test("screenshot extraction rejects non-PNG output", () => {
  assert.throws(() => extractPng(Buffer.from("shell error")), AdbError);
});
