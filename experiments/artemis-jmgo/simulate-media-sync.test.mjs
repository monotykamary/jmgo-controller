import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  scheduleMediaAudioPackets,
  simulateSharedMediaSync,
} from "./simulate-media-sync.mjs";

test("bursty packet arrivals retain media-clock spacing", () => {
  const deadlines = scheduleMediaAudioPackets({
    mediaTimesMs: [0, 5, 10, 15, 20, 25],
    arrivalsMs: [1_000, 1_005, 1_010, 1_010, 1_010, 1_025],
  });
  const intervals = deadlines.slice(1).map((deadline, index) =>
    deadline - deadlines[index],
  );
  for (const interval of intervals) {
    assert.ok(interval >= 4.9 && interval <= 5.1, String(interval));
  }
});

test("shared-clock activation rebases immediately instead of slewing for seconds", () => {
  const deadlines = scheduleMediaAudioPackets({
    mediaTimesMs: [0, 5, 10, 15],
    arrivalsMs: [1_000, 1_005, 1_010, 1_015],
    mediaOffsetsMs: [1_390, 1_390, 1_800, 1_800],
    timelineActive: [false, false, true, true],
  });
  assert.deepEqual(deadlines, [1_090, 1_095, 1_510, 1_515]);
});

test("absolute phase converges for slower and faster sink routes", () => {
  for (const actualSinkLeadMs of [240, 270, 330, 360]) {
    const result = simulateSharedMediaSync({ actualSinkLeadMs });
    assert.ok(Math.abs(result.finalPhaseErrorMs) < 2, JSON.stringify(result));
    assert.ok(Math.abs(result.deadlineCorrectionMs) <= 250);
  }
});

test("generated patches carry the shared media timeline end to end", async () => {
  const artemisPatch = await readFile(
    new URL("./artemis-v20.2.6.patch", import.meta.url),
    "utf8",
  );
  const commonPatch = await readFile(
    new URL("./moonlight-common-c.patch", import.meta.url),
    "utf8",
  );
  const sunshinePatch = await readFile(
    new URL("../sunshine-jmgo/sunshine-v2026.726.710.patch", import.meta.url),
    "utf8",
  );
  for (const symbol of [
    "mediaPresentationTimeMs",
    "getAudioReleaseDeadlineNs",
    "JMGO media audio sync",
    "JMGO latency telemetry",
    "DECODED_IMAGE_START_RETAINED",
    "syntheticDuplicatesCoalesced",
  ]) {
    assert.match(artemisPatch, new RegExp(symbol));
  }
  assert.match(commonPatch, /LiGetCurrentAudioPresentationTime/u);
  assert.match(commonPatch, /presentationLeadMs = 125/u);
  assert.match(sunshinePatch, /media_epoch/u);
  assert.match(sunshinePatch, /capture_timestamp/u);
});
