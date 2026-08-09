import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { simulateVideoStarvation } from "./simulate-video-starvation.mjs";

test("brief image starvation re-buffers without codec or reconnect", () => {
  const result = simulateVideoStarvation({ outageStage: "images", outageDurationMs: 200 });
  assert.deepEqual(result.eventTypes, ["started", "rebuffer", "idr", "recovered"]);
  assert.equal(result.pacing, true);
});

test("sustained image starvation requests IDR and codec recovery once", () => {
  const result = simulateVideoStarvation({ outageStage: "images", outageDurationMs: 1500 });
  assert.deepEqual(result.eventTypes, [
    "started",
    "rebuffer",
    "idr",
    "codec",
    "recovered",
  ]);
  assert.equal(result.eventTypes.includes("reconnect"), false);
});

test("missing decode input escalates once to a stream reconnect", () => {
  const result = simulateVideoStarvation({ outageStage: "input", outageDurationMs: 4000 });
  assert.deepEqual(result.eventTypes, [
    "started",
    "rebuffer",
    "idr",
    "reconnect",
    "recovered",
  ]);
  assert.equal(result.eventTypes.includes("codec"), false);
});

test("the generated Artemis patch carries every recovery boundary", async () => {
  const patch = await readFile(
    new URL("./artemis-v20.2.6.patch", import.meta.url),
    "utf8",
  );
  for (const symbol of [
    "PREPARED_EMPTY_REBUFFER_FRAMES",
    "VIDEO_STARVATION_IDR_NS",
    "VIDEO_STARVATION_CODEC_RECOVERY_NS",
    "VIDEO_STARVATION_RECONNECT_NS",
    "starvationCodecRecoveryRequested",
    "requestIdrFrame",
    "VideoStallListener",
    "JMGO_STALL_MAX_RESTARTS",
    "jmgoStallRecreating",
    "recreate\\(\\);",
  ]) {
    assert.match(patch, new RegExp(symbol));
  }
});
