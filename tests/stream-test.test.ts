import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const parser = join(
  process.cwd(),
  "skills",
  "jmgo-stream-test",
  "scripts",
  "parse-avsync-log.mjs",
);

function telemetry(
  queuedAudioMs: number,
  routeChangeMs: number,
  queueDrain: boolean,
  videoDepthChangeMs: number,
  playbackSpeed: number,
): string {
  return [
    "I/com.limelight.LimeLog: JMGO dynamic audio holdback: 395 ms",
    `queued audio: ${queuedAudioMs} ms`,
    `route change: ${routeChangeMs} ms`,
    `queue drain: ${queueDrain}`,
    `video depth change: ${videoDepthChangeMs} ms`,
    `playback speed: ${playbackSpeed}`,
  ].join(", ");
}

test("A/V telemetry parser accepts convergence and rejects saturation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-avsync-log-test-"));
  try {
    const convergedPath = join(directory, "converged.log");
    await writeFile(
      convergedPath,
      [
        telemetry(410, 0, false, 0, 1),
        telemetry(470, 70, false, 90, 0.998),
        telemetry(500, 105, false, 120, 0.999),
        telemetry(515, 120, false, 128, 1.0004),
      ].join("\n"),
    );
    const converged = spawnSync(process.execPath, [parser, convergedPath], {
      encoding: "utf8",
    });
    assert.equal(converged.status, 0, converged.stderr);
    assert.deepEqual(JSON.parse(converged.stdout), {
      available: true,
      samples: 4,
      maximumQueuedAudioMs: 515,
      queueGrowthMs: 35,
      tailMaximumPhaseErrorMs: 20,
      tailSpeedSaturated: false,
      queueDrainSamples: 0,
      passed: true,
    });

    const saturatedPath = join(directory, "saturated.log");
    await writeFile(
      saturatedPath,
      [
        telemetry(1_150, 150, true, 404, 0.98),
        telemetry(1_230, 150, true, 404, 0.98),
        telemetry(1_270, 150, true, 404, 0.98),
      ].join("\n"),
    );
    const saturated = spawnSync(process.execPath, [parser, saturatedPath], {
      encoding: "utf8",
    });
    assert.equal(saturated.status, 1);
    assert.deepEqual(JSON.parse(saturated.stdout), {
      available: true,
      samples: 3,
      maximumQueuedAudioMs: 1270,
      queueGrowthMs: 0,
      tailMaximumPhaseErrorMs: 254,
      tailSpeedSaturated: true,
      queueDrainSamples: 3,
      passed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
