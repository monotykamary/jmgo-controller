#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const telemetryPattern =
  /timeline=(true|false), video holdback: (\d+) ms, write holdback: (\d+) ms, scheduler compensation: \d+ ms, sink lead: (\d+) ms, queued audio: (\d+) ms, phase error: (-?\d+) ms, deadline correction: (-?\d+) ms, queue drain: (true|false), video depth change: (-?\d+) ms, playback speed: ([0-9.]+)(?:, audio media: (\d+) ms, video media: (-?\d+) ms, desired lead: (-?\d+) ms, ready frames: (\d+))?/u;

const maximumAudioWriteHoldbackMs = 650;
const legacyMaximumQueuedAudioMs = 500;
const maximumQueueBudgetExcessMs = 100;
const maximumAbsoluteQueuedAudioMs = 800;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function analyzeAvSyncLog(text) {
  const samples = text
    .split("\n")
    .map((line) => line.match(telemetryPattern))
    .filter(Boolean)
    .map((match) => ({
      timelineActive: match[1] === "true",
      videoHoldbackMs: Number(match[2]),
      writeHoldbackMs: Number(match[3]),
      sinkLeadMs: Number(match[4]),
      queuedAudioMs: Number(match[5]),
      phaseErrorMs: Number(match[6]),
      deadlineCorrectionMs: Number(match[7]),
      queueDrain: match[8] === "true",
      videoDepthChangeMs: Number(match[9]),
      playbackSpeed: Number(match[10]),
      audioMediaMs: match[11] === undefined ? null : Number(match[11]),
      videoMediaMs: match[12] === undefined ? null : Number(match[12]),
      desiredLeadMs: match[13] === undefined ? null : Number(match[13]),
      readyFrames: match[14] === undefined ? null : Number(match[14]),
    }));

  if (samples.length < 3) {
    return {
      available: false,
      samples: samples.length,
      passed: false,
      reason: "fewer than three shared-media A/V telemetry samples",
    };
  }

  const windowSize = Math.min(3, samples.length);
  const first = samples.slice(0, windowSize);
  const tail = samples.slice(-windowSize);
  const queueDrainSamples = samples.filter((sample) => sample.queueDrain).length;
  const maximumQueuedAudioMs = Math.max(...samples.map((sample) => sample.queuedAudioMs));
  const maximumWriteHoldbackMs = Math.max(...samples.map((sample) => sample.writeHoldbackMs));
  const timestampedSamples = samples.filter((sample) => sample.desiredLeadMs !== null);
  const activeTimestampedSamples = timestampedSamples.filter(
    (sample) => sample.timelineActive,
  );
  const mediaLeadSamples = activeTimestampedSamples.filter(
    (sample) => sample.videoMediaMs >= 0,
  );
  const maximumAudioVideoMediaLeadMs = mediaLeadSamples.length === 0
    ? null
    : Math.max(...mediaLeadSamples.map((sample) => sample.audioMediaMs - sample.videoMediaMs));
  const maximumDesiredLeadMs = activeTimestampedSamples.length === 0
    ? null
    : Math.max(...activeTimestampedSamples.map((sample) => sample.desiredLeadMs));
  const maximumQueueBudgetExcess = activeTimestampedSamples.length === 0
    ? null
    : Math.max(
        0,
        ...activeTimestampedSamples.map((sample) => {
          const queueBudgetMs = Math.max(
            0,
            Math.min(
              maximumAudioWriteHoldbackMs,
              sample.desiredLeadMs - sample.sinkLeadMs,
            ),
          );
          return sample.queuedAudioMs - queueBudgetMs;
        }),
      );
  const tailMaximumPhaseErrorMs = Math.max(
    ...tail.map((sample) => Math.abs(sample.phaseErrorMs)),
  );
  const tailTimelineActive = tail.every((sample) => sample.timelineActive);
  const tailSpeedSaturated =
    tail.every((sample) => sample.playbackSpeed <= 0.9805) ||
    tail.every((sample) => sample.playbackSpeed >= 1.0195);
  const queueGrowthMs =
    mean(tail.map((sample) => sample.queuedAudioMs)) -
    mean(first.map((sample) => sample.queuedAudioMs));
  const failureReasons = [];
  if (!tailTimelineActive) failureReasons.push("shared-media-timeline-inactive");
  if (queueDrainSamples !== 0) failureReasons.push("audio-queue-drain-active");
  const queueTooDeep = activeTimestampedSamples.length === 0
    ? maximumQueuedAudioMs >= legacyMaximumQueuedAudioMs
    : maximumQueuedAudioMs > maximumAbsoluteQueuedAudioMs ||
      maximumQueueBudgetExcess > maximumQueueBudgetExcessMs;
  if (queueTooDeep) failureReasons.push("audio-queue-too-deep");
  if (tailMaximumPhaseErrorMs > 40) failureReasons.push("audio-media-phase-divergence");
  if (tailSpeedSaturated) failureReasons.push("audio-speed-saturated");
  const passed = failureReasons.length === 0;

  return {
    available: true,
    samples: samples.length,
    minimumVideoHoldbackMs: Math.min(...samples.map((sample) => sample.videoHoldbackMs)),
    maximumVideoHoldbackMs: Math.max(...samples.map((sample) => sample.videoHoldbackMs)),
    maximumWriteHoldbackMs,
    maximumQueuedAudioMs,
    queueGrowthMs: Math.round(queueGrowthMs),
    timestampedSamples: timestampedSamples.length,
    maximumAudioVideoMediaLeadMs,
    maximumDesiredLeadMs,
    maximumQueueBudgetExcessMs: maximumQueueBudgetExcess,
    tailMaximumPhaseErrorMs,
    tailDeadlineCorrectionMs: tail.at(-1).deadlineCorrectionMs,
    tailTimelineActive,
    tailSpeedSaturated,
    queueDrainSamples,
    failureReasons,
    passed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: parse-avsync-log.mjs LOGCAT");
    process.exit(2);
  }
  const result = analyzeAvSyncLog(await readFile(path, "utf8"));
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
