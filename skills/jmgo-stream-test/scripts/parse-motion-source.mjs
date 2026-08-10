#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const titlePattern =
  /^JMGO_MOTION frame=(\d+) elapsedMs=([0-9.]+) maxGapMs=([0-9.]+) gaps34=(\d+) blurs=(\d+) hidden=(\d+) lastEpochMs=(\d+)$/u;

function parseTitle(title) {
  const match = title.match(titlePattern);
  if (!match) return null;
  return {
    frame: Number(match[1]),
    elapsedMs: Number(match[2]),
    maximumGapMs: Number(match[3]),
    gapEvents34Ms: Number(match[4]),
    focusLossEvents: Number(match[5]),
    hiddenEvents: Number(match[6]),
    lastEpochMs: Number(match[7]),
  };
}

function rounded(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function analyzeMotionSource(
  startTitle,
  endTitle,
  capturedAtEpochMs,
  focusMode,
  expectedDurationSeconds,
  focusStartApp,
  focusEndApp,
) {
  const start = parseTitle(startTitle);
  const end = parseTitle(endTitle);
  if (!start || !end) {
    return {
      available: false,
      focusMode,
      passed: false,
      reason: "motion telemetry title missing or malformed",
    };
  }

  const frames = end.frame - start.frame;
  const elapsedMs = end.elapsedMs - start.elapsedMs;
  const gapEvents34Ms = end.gapEvents34Ms - start.gapEvents34Ms;
  const focusLossEvents = end.focusLossEvents - start.focusLossEvents;
  const hiddenEvents = end.hiddenEvents - start.hiddenEvents;
  const sourceStaleMs = Math.max(0, capturedAtEpochMs - end.lastEpochMs);
  const averageFPS = elapsedMs > 0 ? (frames * 1000) / elapsedMs : 0;
  const coveragePercent =
    expectedDurationSeconds > 0
      ? (elapsedMs / (expectedDurationSeconds * 1000)) * 100
      : 0;
  const countersMonotonic =
    frames >= 0 && gapEvents34Ms >= 0 && focusLossEvents >= 0 && hiddenEvents >= 0;
  const failureReasons = [];
  if (!countersMonotonic) failureReasons.push("non-monotonic-source-counters");
  if (frames <= 0) failureReasons.push("no-source-frames");
  if (averageFPS < 55 || averageFPS > 65) {
    failureReasons.push("source-rate-outside-55-65-fps");
  }
  if (coveragePercent < 90 || coveragePercent > 110) {
    failureReasons.push("source-coverage-outside-90-110-percent");
  }
  const allowedGapEvents34Ms = Math.max(1, Math.ceil(expectedDurationSeconds / 20));
  if (gapEvents34Ms > allowedGapEvents34Ms) {
    failureReasons.push("source-gap-at-least-34-ms");
  }
  if (!Number.isFinite(sourceStaleMs) || sourceStaleMs > 500) {
    failureReasons.push("source-title-stale");
  }
  if (focusMode === "controlled") {
    // The page's own blur and visibility counters are authoritative across
    // multiple macOS displays and Spaces; the global front app is diagnostic.
    if (start.focusLossEvents !== 0 || focusLossEvents !== 0) {
      failureReasons.push("controlled-focus-event");
    }
    if (start.hiddenEvents !== 0 || hiddenEvents !== 0) {
      failureReasons.push("controlled-hidden-event");
    }
  }
  const passed = failureReasons.length === 0;

  return {
    available: true,
    focusMode,
    focusStartApp,
    focusEndApp,
    frames,
    elapsedMs: rounded(elapsedMs, 1),
    coveragePercent: rounded(coveragePercent),
    averageFPS: rounded(averageFPS),
    gapEvents34Ms,
    focusLossEvents,
    hiddenEvents,
    sourceStaleMs,
    reportedMaximumGapMs: end.maximumGapMs,
    failureReasons,
    passed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [startTitle, endTitle, capturedAt, focusMode, duration, focusStartApp, focusEndApp] =
    process.argv.slice(2);
  if (
    !startTitle ||
    !endTitle ||
    !capturedAt ||
    !focusMode ||
    !duration ||
    !focusStartApp ||
    !focusEndApp
  ) {
    console.error(
      "usage: parse-motion-source.mjs START_TITLE END_TITLE CAPTURED_AT_MS FOCUS_MODE DURATION_SECONDS FOCUS_START_APP FOCUS_END_APP",
    );
    process.exit(2);
  }
  if (focusMode !== "interactive" && focusMode !== "controlled") {
    console.error("focus mode must be interactive or controlled");
    process.exit(2);
  }
  const capturedAtNumber = Number(capturedAt);
  const durationNumber = Number(duration);
  if (!Number.isFinite(capturedAtNumber) || !Number.isFinite(durationNumber)) {
    console.error("capture epoch and duration must be finite numbers");
    process.exit(2);
  }
  const result = analyzeMotionSource(
    startTitle,
    endTitle,
    capturedAtNumber,
    focusMode,
    durationNumber,
    focusStartApp,
    focusEndApp,
  );
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
