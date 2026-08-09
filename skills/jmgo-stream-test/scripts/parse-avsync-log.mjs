#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const telemetryPattern =
  /queued audio: (\d+) ms, route change: (-?\d+) ms, queue drain: (true|false), video depth change: (-?\d+) ms, playback speed: ([0-9.]+)/u;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function analyzeAvSyncLog(text) {
  const samples = text
    .split("\n")
    .map((line) => line.match(telemetryPattern))
    .filter(Boolean)
    .map((match) => ({
      queuedAudioMs: Number(match[1]),
      routeChangeMs: Number(match[2]),
      queueDrain: match[3] === "true",
      videoDepthChangeMs: Number(match[4]),
      playbackSpeed: Number(match[5]),
    }));

  if (samples.length < 3) {
    return {
      available: false,
      samples: samples.length,
      passed: false,
      reason: "fewer than three dynamic A/V telemetry samples",
    };
  }

  const windowSize = Math.min(3, samples.length);
  const first = samples.slice(0, windowSize);
  const tail = samples.slice(-windowSize);
  const queueDrainSamples = samples.filter((sample) => sample.queueDrain).length;
  const maximumQueuedAudioMs = Math.max(...samples.map((sample) => sample.queuedAudioMs));
  const tailMaximumPhaseErrorMs = Math.max(
    ...tail.map((sample) =>
      Math.abs(sample.videoDepthChangeMs - sample.routeChangeMs),
    ),
  );
  const tailSpeedSaturated =
    tail.every((sample) => sample.playbackSpeed <= 0.9805) ||
    tail.every((sample) => sample.playbackSpeed >= 1.0195);
  const queueGrowthMs =
    mean(tail.map((sample) => sample.queuedAudioMs)) -
    mean(first.map((sample) => sample.queuedAudioMs));
  const failureReasons = [];
  if (queueDrainSamples !== 0) failureReasons.push("audio-queue-drain-active");
  if (maximumQueuedAudioMs >= 1_100) failureReasons.push("audio-queue-near-capacity");
  if (tailMaximumPhaseErrorMs > 75) failureReasons.push("audio-route-divergence");
  if (tailSpeedSaturated) failureReasons.push("audio-speed-saturated");
  const passed = failureReasons.length === 0;

  return {
    available: true,
    samples: samples.length,
    maximumQueuedAudioMs,
    queueGrowthMs: Math.round(queueGrowthMs),
    tailMaximumPhaseErrorMs,
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
