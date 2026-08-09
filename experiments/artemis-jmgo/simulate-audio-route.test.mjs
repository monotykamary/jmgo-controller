import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAudioRoute } from "./simulate-audio-route.mjs";

test("audio-route simulation is deterministic", () => {
  assert.deepEqual(simulateAudioRoute(), simulateAudioRoute());
});

test("five-minute measured video ramp converges without filling the PCM pool", () => {
  const result = simulateAudioRoute();

  assert.equal(result.droppedPacketEquivalent, 0);
  assert.equal(result.queueDrainActivations, 0);
  assert.ok(result.maximumQueueFrames < 220);
  assert.ok(Math.abs(result.finalPhaseErrorMs) < 2);
  assert.ok(Math.abs(result.finalSpeed - 1) < 0.001);
});

test("the obsolete 150 ms route clamp reproduces sustained queue overflow", () => {
  const result = simulateAudioRoute({
    routeAdjustmentLimitMs: 150,
    enableQueueDrain: false,
  });

  assert.ok(result.droppedPacketEquivalent > 100);
  assert.equal(result.maximumQueueFrames, 256);
  assert.equal(result.minimumAppliedSpeed, 0.98);
});

test("capacity pressure forces a bounded drain under an untrackable phase step", () => {
  const protectedResult = simulateAudioRoute({
    durationMs: 600_000,
    videoDepthRampMs: 30_000,
    videoDepthFinalMs: 1_000,
  });
  const unprotectedResult = simulateAudioRoute({
    durationMs: 600_000,
    videoDepthRampMs: 30_000,
    videoDepthFinalMs: 1_000,
    enableQueueDrain: false,
  });

  assert.equal(protectedResult.droppedPacketEquivalent, 0);
  assert.ok(protectedResult.queueDrainActivations > 0);
  assert.ok(protectedResult.maximumQueueFrames < 256);
  assert.ok(unprotectedResult.droppedPacketEquivalent > 0);
});
