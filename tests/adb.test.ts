import assert from "node:assert/strict";
import { test } from "node:test";
import { Adb, AdbError, extractPng } from "../src/adb.js";

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

test("input rejects empty and shell-metacharacter arguments before connecting", async () => {
  // Adb.create would need a real adb binary; exercise the validation path by
  // constructing through a subclass that skips the connect/run side effects.
  const adb = Object.create(Adb.prototype) as Adb;
  await assert.rejects(() => adb.input([]), AdbError);
  await assert.rejects(() => adb.input(["keyevent", "$(reboot)"]), /unsafe input argument/);
  await assert.rejects(() => adb.input(["text", "hello world"]), /unsafe input argument/);
  await assert.rejects(() => adb.input(["tap", "500", "500;reboot"]), /unsafe input argument/);
});
