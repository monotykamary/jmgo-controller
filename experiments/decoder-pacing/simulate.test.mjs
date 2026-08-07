import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runSimulation, runSweep } from "./simulate.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./jmgo-h264-720p60.json", import.meta.url), "utf8"),
);

test("simulation is deterministic for a fixed seed", () => {
  assert.deepEqual(runSimulation(fixture, { seed: 901 }), runSimulation(fixture, { seed: 901 }));
});

test("measured stall model produces periodic long decoder gaps", () => {
  const result = runSimulation(fixture, { seed: 901 });
  assert.ok(result.decoder.maximumArrivalGapMs >= 90);
  assert.ok(result.decoder.gapsOver33Ms >= 10);
});

test("stall sweep improves monotonically at the endpoints", () => {
  const sweep = runSweep(fixture, { scales: [1, 0.5, 0.2], seed: 901 });
  assert.ok(sweep[2].decoderMaximumGapMs < sweep[0].decoderMaximumGapMs);
  assert.ok(sweep[2].balancedRepeatedVsyncs < sweep[0].balancedRepeatedVsyncs);
});

test("deeper buffering trades latency for fewer repeated frames", () => {
  const result = runSimulation(fixture, { seed: 901 });
  const balanced = result.strategies.find((item) => item.name === "moonlight-balanced");
  const deep = result.strategies.find((item) => item.name === "buffer-6");
  assert.ok(deep.repeatedVsyncs < balanced.repeatedVsyncs);
  assert.ok(deep.medianLatencyMs > balanced.medianLatencyMs);
});
