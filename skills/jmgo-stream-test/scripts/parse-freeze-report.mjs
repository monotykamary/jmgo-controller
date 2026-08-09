#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const samplePattern =
  /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+).*input_fps=([0-9.]+), enc_fps=([0-9.]+), tx_fps=([0-9.]+).*bit_rate \(video\/target\)=-?\d+\/-?\d+, (\d+)\/(\d+)/u;

function rounded(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function parseEpoch(timestamp) {
  return Date.parse(timestamp.replace(" ", "T"));
}

export function analyzeFreezeReport(text, viewSSIM, capturedAtEpochMs) {
  const samples = text
    .split(/\r?\n/u)
    .map((line) => line.match(samplePattern))
    .filter(Boolean)
    .map((match) => ({
      epochMs: parseEpoch(match[1]),
      inputFPS: Number(match[2]),
      encodeFPS: Number(match[3]),
      transmitFPS: Number(match[4]),
      bitrate: Number(match[5]),
      targetBitrate: Number(match[6]),
    }))
    .filter((sample) => Number.isFinite(sample.epochMs));

  if (samples.length === 0) {
    return {
      available: false,
      viewSSIM: rounded(viewSSIM),
      viewMatch: viewSSIM >= 0.9,
      classification: viewSSIM >= 0.9 ? "views-match-host-telemetry-unavailable" : "inconclusive",
      passed: viewSSIM >= 0.9,
    };
  }

  let maximumLogGapMs = 0;
  for (let index = 1; index < samples.length; index += 1) {
    maximumLogGapMs = Math.max(maximumLogGapMs, samples[index].epochMs - samples[index - 1].epochMs);
  }
  const average = (field) =>
    samples.reduce((sum, sample) => sum + sample[field], 0) / samples.length;
  const minimumInputFPS = Math.min(...samples.map((sample) => sample.inputFPS));
  const minimumBitrate = Math.min(...samples.map((sample) => sample.bitrate));
  const maximumBitrate = Math.max(...samples.map((sample) => sample.bitrate));
  const finalSampleStaleMs = Math.max(0, capturedAtEpochMs - samples.at(-1).epochMs);
  const captureHealthy =
    samples.length >= 5 &&
    minimumInputFPS >= 50 &&
    maximumLogGapMs <= 2500 &&
    finalSampleStaleMs <= 5000;
  const contentChangeObserved =
    maximumBitrate - minimumBitrate >= 500_000 &&
    maximumBitrate >= Math.max(1, minimumBitrate) * 2;
  const viewMatch = viewSSIM >= 0.9;

  let classification;
  if (viewMatch && captureHealthy) classification = "views-synchronized";
  else if (!viewMatch && captureHealthy && contentChangeObserved) {
    classification = "downstream-view-stale";
  } else if (!viewMatch && captureHealthy) classification = "views-mismatch-host-change-unproven";
  else if (!captureHealthy) classification = "host-capture-unhealthy-or-unobserved";
  else classification = "inconclusive";

  return {
    available: true,
    samples: samples.length,
    observedSeconds: rounded((samples.at(-1).epochMs - samples[0].epochMs) / 1000, 1),
    minimumInputFPS: rounded(minimumInputFPS),
    averageInputFPS: rounded(average("inputFPS")),
    averageEncodeFPS: rounded(average("encodeFPS")),
    averageTransmitFPS: rounded(average("transmitFPS")),
    maximumLogGapMs,
    finalSampleStaleMs,
    minimumBitrate,
    maximumBitrate,
    contentChangeObserved,
    captureHealthy,
    viewSSIM: rounded(viewSSIM),
    viewMatch,
    classification,
    passed: viewMatch && captureHealthy,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [logPath, viewSSIM, capturedAtEpochMs] = process.argv.slice(2);
  if (!logPath || !viewSSIM || !capturedAtEpochMs) {
    console.error("usage: parse-freeze-report.mjs VCP_LOG VIEW_SSIM CAPTURED_AT_EPOCH_MS");
    process.exit(2);
  }
  const ssim = Number(viewSSIM);
  const capturedAt = Number(capturedAtEpochMs);
  if (!Number.isFinite(ssim) || ssim < 0 || ssim > 1 || !Number.isFinite(capturedAt)) {
    console.error("view SSIM must be 0-1 and capture epoch must be finite");
    process.exit(2);
  }
  const result = analyzeFreezeReport(readFileSync(logPath, "utf8"), ssim, capturedAt);
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
