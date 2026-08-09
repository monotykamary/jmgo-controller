import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const avsyncParser = join(
  process.cwd(),
  "skills",
  "jmgo-stream-test",
  "scripts",
  "parse-avsync-log.mjs",
);
const motionParser = join(
  process.cwd(),
  "skills",
  "jmgo-stream-test",
  "scripts",
  "parse-motion-source.mjs",
);
const freezeParser = join(
  process.cwd(),
  "skills",
  "jmgo-stream-test",
  "scripts",
  "parse-freeze-report.mjs",
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
    const converged = spawnSync(process.execPath, [avsyncParser, convergedPath], {
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
      failureReasons: [],
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
    const saturated = spawnSync(process.execPath, [avsyncParser, saturatedPath], {
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
      failureReasons: [
        "audio-queue-drain-active",
        "audio-queue-near-capacity",
        "audio-route-divergence",
        "audio-speed-saturated",
      ],
      passed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function motionTitle({
  frame,
  elapsedMs,
  maximumGapMs = 16.8,
  gapEvents34Ms = 0,
  focusLossEvents = 0,
  hiddenEvents = 0,
  lastEpochMs,
}: {
  frame: number;
  elapsedMs: number;
  maximumGapMs?: number;
  gapEvents34Ms?: number;
  focusLossEvents?: number;
  hiddenEvents?: number;
  lastEpochMs: number;
}): string {
  return [
    `JMGO_MOTION frame=${frame}`,
    `elapsedMs=${elapsedMs}`,
    `maxGapMs=${maximumGapMs}`,
    `gaps34=${gapEvents34Ms}`,
    `blurs=${focusLossEvents}`,
    `hidden=${hiddenEvents}`,
    `lastEpochMs=${lastEpochMs}`,
  ].join(" ");
}

function runMotionParser(
  startTitle: string,
  endTitle: string,
  focusMode: "interactive" | "controlled",
  focusEndApp = focusMode === "controlled" ? "Safari" : "Dia",
) {
  const focusStartApp = focusMode === "controlled" ? "Safari" : "Dia";
  return spawnSync(
    process.execPath,
    [
      motionParser,
      startTitle,
      endTitle,
      "10230100",
      focusMode,
      "20",
      focusStartApp,
      focusEndApp,
    ],
    { encoding: "utf8" },
  );
}

test("motion parser separates healthy interaction from focus loss and rAF throttling", () => {
  const start = motionTitle({
    frame: 180,
    elapsedMs: 3000,
    focusLossEvents: 1,
    lastEpochMs: 10203000,
  });
  const healthyEnd = motionTitle({
    frame: 1380,
    elapsedMs: 23000,
    focusLossEvents: 1,
    lastEpochMs: 10230000,
  });
  const healthy = runMotionParser(start, healthyEnd, "interactive");
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.deepEqual(JSON.parse(healthy.stdout), {
    available: true,
    focusMode: "interactive",
    focusStartApp: "Dia",
    focusEndApp: "Dia",
    frames: 1200,
    elapsedMs: 20000,
    coveragePercent: 100,
    averageFPS: 60,
    gapEvents34Ms: 0,
    focusLossEvents: 0,
    hiddenEvents: 0,
    sourceStaleMs: 100,
    reportedMaximumGapMs: 16.8,
    failureReasons: [],
    passed: true,
  });

  const controlledStart = motionTitle({
    frame: 180,
    elapsedMs: 3000,
    lastEpochMs: 10203000,
  });
  const focusLostEnd = motionTitle({
    frame: 1380,
    elapsedMs: 23000,
    focusLossEvents: 1,
    lastEpochMs: 10230000,
  });
  const focusLost = runMotionParser(controlledStart, focusLostEnd, "controlled");
  assert.equal(focusLost.status, 1);
  assert.equal(JSON.parse(focusLost.stdout).focusLossEvents, 1);
  assert.ok(JSON.parse(focusLost.stdout).failureReasons.includes("controlled-focus-event"));
  assert.equal(JSON.parse(focusLost.stdout).passed, false);

  const wrongFocus = runMotionParser(controlledStart, healthyEnd, "controlled", "Dia");
  assert.equal(wrongFocus.status, 1);
  assert.equal(JSON.parse(wrongFocus.stdout).focusEndApp, "Dia");
  assert.ok(
    JSON.parse(wrongFocus.stdout).failureReasons.includes("controlled-focus-boundary"),
  );
  assert.equal(JSON.parse(wrongFocus.stdout).passed, false);

  const throttledEnd = motionTitle({
    frame: 200,
    elapsedMs: 23000,
    maximumGapMs: 1000,
    gapEvents34Ms: 19,
    focusLossEvents: 1,
    lastEpochMs: 10230000,
  });
  const throttled = runMotionParser(start, throttledEnd, "interactive");
  assert.equal(throttled.status, 1);
  assert.equal(JSON.parse(throttled.stdout).averageFPS, 1);
  assert.equal(JSON.parse(throttled.stdout).gapEvents34Ms, 19);
  assert.ok(
    JSON.parse(throttled.stdout).failureReasons.includes("source-rate-outside-55-65-fps"),
  );
  assert.ok(
    JSON.parse(throttled.stdout).failureReasons.includes("source-gap-at-least-34-ms"),
  );
  assert.equal(JSON.parse(throttled.stdout).passed, false);
});

test("freeze report separates synchronized and stale host/client views", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-freeze-report-test-"));
  try {
    const healthyPath = join(directory, "healthy.log");
    const lines = [
      ["03:00:00.000", 60, 60, 60, 600_000],
      ["03:00:01.000", 60, 61, 60, 700_000],
      ["03:00:02.000", 61, 60, 61, 4_000_000],
      ["03:00:03.000", 59, 59, 59, 900_000],
      ["03:00:04.000", 60, 60, 60, 650_000],
    ].map(
      ([time, input, encode, transmit, bitrate]) =>
        [
          `2026-08-10 ${time} Df Sunshine[123:456]`,
          `input_fps=${input}, enc_fps=${encode}, tx_fps=${transmit}, idr_fps=0.00,`,
          `bit_rate (video/target)=-1/-1, ${bitrate}/14988000`,
        ].join(" "),
    );
    await writeFile(healthyPath, lines.join("\n"));
    const capturedAt = new Date("2026-08-10T03:00:05").getTime().toString();
    const synchronized = spawnSync(
      process.execPath,
      [freezeParser, healthyPath, "0.959225", capturedAt],
      { encoding: "utf8" },
    );
    assert.equal(synchronized.status, 0, synchronized.stderr);
    assert.deepEqual(JSON.parse(synchronized.stdout), {
      available: true,
      samples: 5,
      observedSeconds: 4,
      minimumInputFPS: 59,
      averageInputFPS: 60,
      averageEncodeFPS: 60,
      averageTransmitFPS: 60,
      maximumLogGapMs: 1000,
      finalSampleStaleMs: 1000,
      minimumBitrate: 600000,
      maximumBitrate: 4000000,
      contentChangeObserved: true,
      captureHealthy: true,
      viewSSIM: 0.959,
      viewMatch: true,
      classification: "views-synchronized",
      passed: true,
    });

    const stale = spawnSync(
      process.execPath,
      [freezeParser, healthyPath, "0.4", capturedAt],
      { encoding: "utf8" },
    );
    assert.equal(stale.status, 1);
    assert.equal(JSON.parse(stale.stdout).classification, "downstream-view-stale");

    const unhealthyPath = join(directory, "unhealthy.log");
    await writeFile(
      unhealthyPath,
      lines
        .map((line) => line.replace(/input_fps=(?:59|60|61)/u, "input_fps=30"))
        .join("\n"),
    );
    const unhealthy = spawnSync(
      process.execPath,
      [freezeParser, unhealthyPath, "0.4", capturedAt],
      { encoding: "utf8" },
    );
    assert.equal(unhealthy.status, 1);
    assert.equal(
      JSON.parse(unhealthy.stdout).classification,
      "host-capture-unhealthy-or-unobserved",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
