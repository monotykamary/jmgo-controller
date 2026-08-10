#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const telemetryPattern =
  /video holdback=(\d+) ms, decoded=(\d+)-(\d+), prepared=(\d+)-(\d+), prepare max=([0-9.]+) ms, writer max=([0-9.]+) ms, handoff margin min=(-?[0-9.]+) ms, marker unique=(\d+), repeated=(\d+), skipped=(\d+), synthetic coalesced=(\d+)/u;

export function analyzeLatencyLog(text) {
  const samples = text
    .split("\n")
    .map((line) => line.match(telemetryPattern))
    .filter(Boolean)
    .map((match) => ({
      videoHoldbackMs: Number(match[1]),
      decodedMinimum: Number(match[2]),
      decodedMaximum: Number(match[3]),
      preparedMinimum: Number(match[4]),
      preparedMaximum: Number(match[5]),
      preparationMaximumMs: Number(match[6]),
      writerMaximumMs: Number(match[7]),
      handoffMinimumMarginMs: Number(match[8]),
      markerUniqueFrames: Number(match[9]),
      markerRepeatedFrames: Number(match[10]),
      markerSkippedFrames: Number(match[11]),
      syntheticDuplicatesCoalesced: Number(match[12]),
    }));

  if (samples.length === 0) {
    return {
      available: false,
      samples: 0,
      passed: false,
      reason: "no latency telemetry samples",
    };
  }

  const markerUniqueFrames = samples.reduce(
    (sum, sample) => sum + sample.markerUniqueFrames,
    0,
  );
  const markerRepeatedFrames = samples.reduce(
    (sum, sample) => sum + sample.markerRepeatedFrames,
    0,
  );
  const markerSkippedFrames = samples.reduce(
    (sum, sample) => sum + sample.markerSkippedFrames,
    0,
  );
  // A capture-clock repeat followed by a source-counter skip is phase resampling,
  // not client content loss. Only the unpaired imbalance identifies replacement.
  const syntheticDuplicatesCoalesced = samples.reduce(
    (sum, sample) => sum + sample.syntheticDuplicatesCoalesced,
    0,
  );
  const effectiveRepeatedFrames =
    markerRepeatedFrames + syntheticDuplicatesCoalesced;
  const markerDiscontinuityImbalance = Math.abs(
    effectiveRepeatedFrames - markerSkippedFrames,
  );
  const allowedMarkerDiscontinuityImbalance = Math.max(
    1,
    Math.ceil(markerUniqueFrames / 200),
  );
  const markerResamplingEvents =
    effectiveRepeatedFrames + markerSkippedFrames;
  const allowedMarkerResamplingEvents = Math.max(
    1,
    Math.ceil((markerUniqueFrames + effectiveRepeatedFrames) / 8),
  );
  const failureReasons = [];
  if (markerUniqueFrames === 0) failureReasons.push("frame-marker-unavailable");
  if (
    markerDiscontinuityImbalance > allowedMarkerDiscontinuityImbalance
  ) {
    failureReasons.push("source-frame-continuity");
  }
  if (markerResamplingEvents > allowedMarkerResamplingEvents) {
    failureReasons.push("source-frame-resampling");
  }
  const minimumHandoffMarginMs = Math.min(
    ...samples.map((sample) => sample.handoffMinimumMarginMs),
  );
  if (minimumHandoffMarginMs < 5) failureReasons.push("handoff-margin-below-5-ms");
  const maximumPreparationMs = Math.max(
    ...samples.map((sample) => sample.preparationMaximumMs),
  );
  if (maximumPreparationMs >= 30) failureReasons.push("image-preparation-at-least-30-ms");
  const maximumWriterMs = Math.max(
    ...samples.map((sample) => sample.writerMaximumMs),
  );
  if (maximumWriterMs >= 12) failureReasons.push("image-writer-at-least-12-ms");

  return {
    available: true,
    samples: samples.length,
    minimumVideoHoldbackMs: Math.min(...samples.map((sample) => sample.videoHoldbackMs)),
    maximumVideoHoldbackMs: Math.max(...samples.map((sample) => sample.videoHoldbackMs)),
    minimumDecodedQueueDepth: Math.min(...samples.map((sample) => sample.decodedMinimum)),
    maximumDecodedQueueDepth: Math.max(...samples.map((sample) => sample.decodedMaximum)),
    minimumPreparedQueueDepth: Math.min(...samples.map((sample) => sample.preparedMinimum)),
    maximumPreparedQueueDepth: Math.max(...samples.map((sample) => sample.preparedMaximum)),
    maximumPreparationMs,
    maximumWriterMs,
    minimumHandoffMarginMs,
    markerUniqueFrames,
    markerRepeatedFrames,
    markerSkippedFrames,
    syntheticDuplicatesCoalesced,
    markerDiscontinuityImbalance,
    allowedMarkerDiscontinuityImbalance,
    markerResamplingEvents,
    allowedMarkerResamplingEvents,
    failureReasons,
    passed: failureReasons.length === 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: parse-latency-log.mjs LOGCAT");
    process.exit(2);
  }
  const result = analyzeLatencyLog(await readFile(path, "utf8"));
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
