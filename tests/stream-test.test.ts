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
const latencyParser = join(
  process.cwd(),
  "skills",
  "jmgo-stream-test",
  "scripts",
  "parse-latency-log.mjs",
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

function telemetry({
  timelineActive,
  videoHoldbackMs,
  writeHoldbackMs,
  sinkLeadMs,
  queuedAudioMs,
  phaseErrorMs,
  deadlineCorrectionMs,
  queueDrain,
  videoDepthChangeMs,
  playbackSpeed,
  audioMediaMs = 10_000,
  videoMediaMs = 9_300,
  desiredLeadMs = 700,
  readyFrames = 20,
}: {
  timelineActive: boolean;
  videoHoldbackMs: number;
  writeHoldbackMs: number;
  sinkLeadMs: number;
  queuedAudioMs: number;
  phaseErrorMs: number;
  deadlineCorrectionMs: number;
  queueDrain: boolean;
  videoDepthChangeMs: number;
  playbackSpeed: number;
  audioMediaMs?: number;
  videoMediaMs?: number;
  desiredLeadMs?: number;
  readyFrames?: number;
}): string {
  return [
    `I/com.limelight.LimeLog: JMGO media audio sync: timeline=${timelineActive}`,
    `video holdback: ${videoHoldbackMs} ms`,
    `write holdback: ${writeHoldbackMs} ms`,
    "scheduler compensation: 2 ms",
    `sink lead: ${sinkLeadMs} ms`,
    `queued audio: ${queuedAudioMs} ms`,
    `phase error: ${phaseErrorMs} ms`,
    `deadline correction: ${deadlineCorrectionMs} ms`,
    `queue drain: ${queueDrain}`,
    `video depth change: ${videoDepthChangeMs} ms`,
    `playback speed: ${playbackSpeed}`,
    `audio media: ${audioMediaMs} ms`,
    `video media: ${videoMediaMs} ms`,
    `desired lead: ${desiredLeadMs} ms`,
    `ready frames: ${readyFrames}`,
  ].join(", ");
}

const baseTelemetry = {
  timelineActive: true,
  videoHoldbackMs: 390,
  writeHoldbackMs: 90,
  sinkLeadMs: 300,
  queuedAudioMs: 100,
  phaseErrorMs: 3,
  deadlineCorrectionMs: 10,
  queueDrain: false,
  videoDepthChangeMs: 0,
  playbackSpeed: 1,
};

test("A/V telemetry parser accepts shared-media convergence and rejects drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-avsync-log-test-"));
  try {
    const convergedPath = join(directory, "converged.log");
    await writeFile(
      convergedPath,
      [
        telemetry({ ...baseTelemetry, timelineActive: false, queuedAudioMs: 100, phaseErrorMs: 50 }),
        telemetry({ ...baseTelemetry, queuedAudioMs: 110, phaseErrorMs: 20 }),
        telemetry({ ...baseTelemetry, queuedAudioMs: 105, phaseErrorMs: 8 }),
        telemetry({ ...baseTelemetry, queuedAudioMs: 100, phaseErrorMs: 3 }),
      ].join("\n"),
    );
    const converged = spawnSync(process.execPath, [avsyncParser, convergedPath], {
      encoding: "utf8",
    });
    assert.equal(converged.status, 0, converged.stderr);
    assert.deepEqual(JSON.parse(converged.stdout), {
      available: true,
      samples: 4,
      minimumVideoHoldbackMs: 390,
      maximumVideoHoldbackMs: 390,
      maximumWriteHoldbackMs: 90,
      maximumQueuedAudioMs: 110,
      queueGrowthMs: 0,
      timestampedSamples: 4,
      maximumAudioVideoMediaLeadMs: 700,
      maximumDesiredLeadMs: 700,
      maximumQueueBudgetExcessMs: 0,
      tailMaximumPhaseErrorMs: 20,
      tailDeadlineCorrectionMs: 10,
      tailTimelineActive: true,
      tailSpeedSaturated: false,
      queueDrainSamples: 0,
      failureReasons: [],
      passed: true,
    });

    const saturatedPath = join(directory, "saturated.log");
    await writeFile(
      saturatedPath,
      [
        telemetry({ ...baseTelemetry, timelineActive: false, queuedAudioMs: 520, phaseErrorMs: 80, queueDrain: true, playbackSpeed: 0.98 }),
        telemetry({ ...baseTelemetry, timelineActive: false, queuedAudioMs: 540, phaseErrorMs: 90, queueDrain: true, playbackSpeed: 0.98 }),
        telemetry({ ...baseTelemetry, timelineActive: false, queuedAudioMs: 560, phaseErrorMs: 100, queueDrain: true, playbackSpeed: 0.98 }),
      ].join("\n"),
    );
    const saturated = spawnSync(process.execPath, [avsyncParser, saturatedPath], {
      encoding: "utf8",
    });
    assert.equal(saturated.status, 1);
    const mediaBudgetPath = join(directory, "media-budget.log");
    await writeFile(
      mediaBudgetPath,
      [
        telemetry({
          ...baseTelemetry,
          sinkLeadMs: 290,
          queuedAudioMs: 535,
          phaseErrorMs: 8,
          audioMediaMs: 20_000,
          videoMediaMs: 19_200,
          desiredLeadMs: 810,
        }),
        telemetry({
          ...baseTelemetry,
          sinkLeadMs: 290,
          queuedAudioMs: 530,
          phaseErrorMs: 6,
          audioMediaMs: 25_000,
          videoMediaMs: 24_200,
          desiredLeadMs: 810,
        }),
        telemetry({
          ...baseTelemetry,
          sinkLeadMs: 290,
          queuedAudioMs: 533,
          phaseErrorMs: 4,
          audioMediaMs: 30_000,
          videoMediaMs: 29_200,
          desiredLeadMs: 810,
        }),
      ].join("\n"),
    );
    const mediaBudget = spawnSync(process.execPath, [avsyncParser, mediaBudgetPath], {
      encoding: "utf8",
    });
    assert.equal(mediaBudget.status, 0, mediaBudget.stderr);
    assert.equal(JSON.parse(mediaBudget.stdout).maximumQueueBudgetExcessMs, 15);
    assert.equal(JSON.parse(mediaBudget.stdout).tailMaximumPhaseErrorMs, 8);
    assert.equal(JSON.parse(mediaBudget.stdout).passed, true);

    assert.deepEqual(JSON.parse(saturated.stdout), {
      available: true,
      samples: 3,
      minimumVideoHoldbackMs: 390,
      maximumVideoHoldbackMs: 390,
      maximumWriteHoldbackMs: 90,
      maximumQueuedAudioMs: 560,
      queueGrowthMs: 0,
      timestampedSamples: 3,
      maximumAudioVideoMediaLeadMs: null,
      maximumDesiredLeadMs: null,
      maximumQueueBudgetExcessMs: null,
      tailMaximumPhaseErrorMs: 100,
      tailDeadlineCorrectionMs: 10,
      tailTimelineActive: false,
      tailSpeedSaturated: true,
      queueDrainSamples: 3,
      failureReasons: [
        "shared-media-timeline-inactive",
        "audio-queue-drain-active",
        "audio-queue-too-deep",
        "audio-media-phase-divergence",
        "audio-speed-saturated",
      ],
      passed: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function latencyTelemetry({
  holdback = 390,
  decoded = "4-12",
  prepared = "4-5",
  preparation = 4,
  writer = 2,
  margin = 7,
  unique = 300,
  repeated = 0,
  skipped = 0,
  synthetic = 0,
} = {}): string {
  return [
    `I/com.limelight.LimeLog: JMGO latency telemetry: video holdback=${holdback} ms`,
    `decoded=${decoded}`,
    `prepared=${prepared}`,
    `prepare max=${preparation} ms`,
    `writer max=${writer} ms`,
    `handoff margin min=${margin} ms`,
    `marker unique=${unique}`,
    `repeated=${repeated}`,
    `skipped=${skipped}`,
    `synthetic coalesced=${synthetic}`,
  ].join(", ");
}

test("latency telemetry parser enforces marker and handoff headroom", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-latency-log-test-"));
  try {
    const passingPath = join(directory, "passing.log");
    await writeFile(passingPath, [latencyTelemetry(), latencyTelemetry()].join("\n"));
    const passing = spawnSync(process.execPath, [latencyParser, passingPath], {
      encoding: "utf8",
    });
    assert.equal(passing.status, 0, passing.stderr);
    const passingResult = JSON.parse(passing.stdout);
    assert.equal(passingResult.markerUniqueFrames, 600);
    assert.equal(passingResult.minimumHandoffMarginMs, 7);
    assert.equal(passingResult.passed, true);

    const boundedResamplingPath = join(directory, "bounded-resampling.log");
    await writeFile(
      boundedResamplingPath,
      latencyTelemetry({ unique: 300, repeated: 20, skipped: 20 }),
    );
    const boundedResampling = spawnSync(
      process.execPath,
      [latencyParser, boundedResamplingPath],
      { encoding: "utf8" },
    );
    assert.equal(boundedResampling.status, 0, boundedResampling.stderr);
    assert.equal(JSON.parse(boundedResampling.stdout).markerResamplingEvents, 40);

    const excessiveResamplingPath = join(directory, "excessive-resampling.log");
    await writeFile(
      excessiveResamplingPath,
      latencyTelemetry({ unique: 300, repeated: 21, skipped: 21 }),
    );
    const excessiveResampling = spawnSync(
      process.execPath,
      [latencyParser, excessiveResamplingPath],
      { encoding: "utf8" },
    );
    assert.equal(excessiveResampling.status, 1);
    assert.deepEqual(JSON.parse(excessiveResampling.stdout).failureReasons, [
      "source-frame-resampling",
    ]);

    const failingPath = join(directory, "failing.log");
    await writeFile(
      failingPath,
      latencyTelemetry({ repeated: 3, preparation: 31, writer: 12, margin: 4 }),
    );
    const failing = spawnSync(process.execPath, [latencyParser, failingPath], {
      encoding: "utf8",
    });
    assert.equal(failing.status, 1);
    assert.deepEqual(JSON.parse(failing.stdout).failureReasons, [
      "source-frame-continuity",
      "handoff-margin-below-5-ms",
      "image-preparation-at-least-30-ms",
      "image-writer-at-least-12-ms",
    ]);
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
  const boundedJitterEnd = motionTitle({
    frame: 1380,
    elapsedMs: 23000,
    maximumGapMs: 53,
    gapEvents34Ms: 1,
    lastEpochMs: 10230000,
  });
  const boundedJitter = runMotionParser(
    controlledStart,
    boundedJitterEnd,
    "controlled",
  );
  assert.equal(boundedJitter.status, 0, boundedJitter.stderr);
  assert.equal(JSON.parse(boundedJitter.stdout).gapEvents34Ms, 1);
  assert.equal(JSON.parse(boundedJitter.stdout).passed, true);

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

  const wrongGlobalFocus = runMotionParser(
    controlledStart,
    boundedJitterEnd,
    "controlled",
    "Dia",
  );
  assert.equal(wrongGlobalFocus.status, 0, wrongGlobalFocus.stderr);
  assert.equal(JSON.parse(wrongGlobalFocus.stdout).focusEndApp, "Dia");
  assert.equal(JSON.parse(wrongGlobalFocus.stdout).passed, true);

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
