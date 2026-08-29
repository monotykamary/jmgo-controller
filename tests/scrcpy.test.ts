import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScrcpyArgs } from "../src/scrcpy.js";

const serial = "192.168.68.58:5555";

function argsWith(options: Parameters<typeof buildScrcpyArgs>[1]) {
  return buildScrcpyArgs(serial, options);
}

test("default args mirror at 60 fps without video buffering", () => {
  const args = buildScrcpyArgs(serial);
  assert.deepEqual(args, ["--serial", serial, "--max-fps=60", "--stay-awake", "--no-audio"]);
});

test("video buffer is opt-in and appended as a scrcpy flag", () => {
  const args = argsWith({ videoBuffer: 80 });
  assert.equal(args.filter((arg) => arg === "--stay-awake").length, 1);
  assert.ok(args.includes("--video-buffer=80"), "--video-buffer=80 present");
  assert.ok(args.indexOf("--video-buffer=80") > args.indexOf("--max-fps=60"), "buffer flag follows max-fps");
});

test("video buffer is omitted when mirroring is off", () => {
  const args = argsWith({ mirror: false, videoBuffer: 80 });
  assert.deepEqual(args, ["--serial", serial, "--no-video", "--no-audio"]);
});

test("max-fps and extra args compose with the video buffer", () => {
  const args = argsWith({ maxFps: 30, videoBuffer: 40, extraArgs: ["--window-title=JMGO"] });
  assert.deepEqual(
    args.slice(2),
    ["--max-fps=30", "--stay-awake", "--video-buffer=40", "--no-audio", "--window-title=JMGO"],
  );
});

test("audio extra flags suppress the default --no-audio", () => {
  const args = argsWith({ extraArgs: ["--audio-codec=aac"] });
  assert.ok(!args.includes("--no-audio"));
  assert.ok(args.includes("--audio-codec=aac"));
});
