import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScrcpyArgs } from "../src/scrcpy.js";

test("scrcpy defaults to control-only UHID input", () => {
  assert.deepEqual(buildScrcpyArgs("192.168.1.50:5555"), [
    "--serial",
    "192.168.1.50:5555",
    "--no-video",
    "--no-audio",
    "--mouse=uhid",
    "--keyboard=uhid",
  ]);
});

test("scrcpy mirror mode and extra arguments are preserved", () => {
  assert.deepEqual(
    buildScrcpyArgs("projector.local:5555", {
      mirror: true,
      extraArgs: ["--max-fps=30", "--stay-awake"],
    }),
    [
      "--serial",
      "projector.local:5555",
      "--mouse=uhid",
      "--keyboard=uhid",
      "--max-fps=30",
      "--stay-awake",
    ],
  );
});
