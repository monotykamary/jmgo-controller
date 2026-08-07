#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultFixtureUrl = new URL("./jmgo-h264-720p60.json", import.meta.url);

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function generateDecoderTrace(fixture, options = {}) {
  const fps = fixture.stream.requestedFps;
  const frameMs = 1000 / fps;
  const durationMs = (options.durationSeconds ?? fixture.stream.durationSeconds) * 1000;
  const model = fixture.model;
  const random = makeRandom(options.seed ?? 901);
  const stallDurations = shuffled(model.stallDurationsMs, random);
  const schedulerScale = options.schedulerScale ?? options.stallScale ?? 1;
  const loadScale = options.loadScale ?? 1;
  const stallScale = schedulerScale * model.stallCalibration;
  const frames = [];
  let decoderAvailableMs = 0;
  let stallIndex = 0;
  let nextStallMs = model.stallPeriodMs;

  for (let frameIndex = 0; frameIndex < Math.ceil(durationMs / frameMs); frameIndex += 1) {
    const ptsMs = frameIndex * frameMs;
    let serviceStartMs = Math.max(ptsMs, decoderAvailableMs);

    while (serviceStartMs >= nextStallMs) {
      const stallDurationMs = stallDurations[stallIndex % stallDurations.length] * stallScale;
      const stallEndMs = nextStallMs + stallDurationMs;
      stallIndex += 1;
      nextStallMs += model.stallPeriodMs;
      if (serviceStartMs < stallEndMs) serviceStartMs = stallEndMs;
    }

    const isBacklogged = serviceStartMs - ptsMs > frameMs;
    const serviceMs =
      (isBacklogged ? model.catchUpServiceMs : model.decoderServiceMs) * loadScale;
    let completionMs = serviceStartMs + serviceMs;

    if (completionMs >= nextStallMs) {
      const stallDurationMs = stallDurations[stallIndex % stallDurations.length] * stallScale;
      completionMs = nextStallMs + stallDurationMs + serviceMs;
      stallIndex += 1;
      nextStallMs += model.stallPeriodMs;
    }

    const arrivalMs = Math.ceil(completionMs / model.outputSchedulerQuantumMs) * model.outputSchedulerQuantumMs;
    decoderAvailableMs = Math.max(completionMs, arrivalMs);
    frames.push({ frameIndex, ptsMs, arrivalMs });
  }

  return { durationMs, fps, frameMs, frames };
}

export function simulatePresentation(trace, strategy) {
  const queue = [];
  const latencies = [];
  let decoderCursor = 0;
  let displayedFrame;
  let playbackStarted = strategy.prebufferFrames === 0;
  let droppedFrames = 0;
  let repeatedVsyncs = 0;
  let currentRepeatRun = 0;
  let maxRepeatRun = 0;
  let uniqueFramesDisplayed = 0;
  let maximumQueueDepth = 0;

  for (let vsyncMs = 0; vsyncMs < trace.durationMs; vsyncMs += trace.frameMs) {
    while (
      decoderCursor < trace.frames.length &&
      trace.frames[decoderCursor].arrivalMs <= vsyncMs + 0.0001
    ) {
      const frame = trace.frames[decoderCursor];
      decoderCursor += 1;
      if (strategy.mode === "latest") {
        if (queue.length > 0) droppedFrames += queue.length;
        queue.length = 0;
        queue.push(frame);
      } else {
        if (queue.length === strategy.capacity) {
          queue.shift();
          droppedFrames += 1;
        }
        queue.push(frame);
      }
      maximumQueueDepth = Math.max(maximumQueueDepth, queue.length);
    }

    if (!playbackStarted && queue.length >= strategy.prebufferFrames) playbackStarted = true;
    if (!playbackStarted) continue;

    const nextFrame = queue.shift();
    if (nextFrame) {
      displayedFrame = nextFrame;
      uniqueFramesDisplayed += 1;
      latencies.push(vsyncMs - nextFrame.ptsMs);
      currentRepeatRun = 0;
    } else if (displayedFrame) {
      repeatedVsyncs += 1;
      currentRepeatRun += 1;
      maxRepeatRun = Math.max(maxRepeatRun, currentRepeatRun);
    }
  }

  return {
    name: strategy.name,
    capacity: strategy.capacity,
    prebufferFrames: strategy.prebufferFrames,
    uniqueFramesDisplayed,
    droppedFrames,
    repeatedVsyncs,
    repeatPercent: round((repeatedVsyncs / (trace.durationMs / trace.frameMs)) * 100),
    maximumFreezeMs: round(maxRepeatRun * trace.frameMs),
    medianLatencyMs: round(percentile(latencies, 0.5)),
    p95LatencyMs: round(percentile(latencies, 0.95)),
    maximumLatencyMs: round(Math.max(0, ...latencies)),
    maximumQueueDepth,
  };
}

export function runSimulation(fixture, options = {}) {
  const trace = generateDecoderTrace(fixture, options);
  const arrivalGaps = trace.frames.slice(1).map((frame, index) => frame.arrivalMs - trace.frames[index].arrivalMs);
  const strategies = [
    { name: "lowest-latency", mode: "latest", capacity: 1, prebufferFrames: 0 },
    { name: "moonlight-balanced", mode: "queue", capacity: 2, prebufferFrames: 1 },
    { name: "buffer-3", mode: "queue", capacity: 3, prebufferFrames: 3 },
    { name: "buffer-6", mode: "queue", capacity: 6, prebufferFrames: 6 },
  ];
  return {
    profile: fixture.name,
    assumptions: {
      durationSeconds: trace.durationMs / 1000,
      requestedFps: trace.fps,
      periodicStallMs: fixture.model.stallPeriodMs,
      schedulerScale: options.schedulerScale ?? options.stallScale ?? 1,
      effectiveSchedulerScale:
        (options.schedulerScale ?? options.stallScale ?? 1) * fixture.model.stallCalibration,
      loadScale: options.loadScale ?? 1,
      seed: options.seed ?? 901,
      warning: "SurfaceFlinger histograms contain no ordering; periodic decoder stalls and catch-up bursts are reconstructed.",
    },
    decoder: {
      frames: trace.frames.length,
      medianArrivalGapMs: round(percentile(arrivalGaps, 0.5)),
      p95ArrivalGapMs: round(percentile(arrivalGaps, 0.95)),
      maximumArrivalGapMs: round(Math.max(...arrivalGaps)),
      gapsOver33Ms: arrivalGaps.filter((gap) => gap > 33).length,
    },
    strategies: strategies.map((strategy) => simulatePresentation(trace, strategy)),
  };
}

export function runSweep(fixture, options = {}) {
  const scales = options.scales ?? [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
  const parameter = options.parameter ?? "scheduler";
  return scales.map((scale) => {
    const scaledOptions =
      parameter === "load" ? { ...options, loadScale: scale } : { ...options, schedulerScale: scale };
    const result = runSimulation(fixture, scaledOptions);
    const balanced = result.strategies.find((item) => item.name === "moonlight-balanced");
    const buffer3 = result.strategies.find((item) => item.name === "buffer-3");
    return {
      parameter,
      scale,
      decoderMaximumGapMs: result.decoder.maximumArrivalGapMs,
      balancedMaximumFreezeMs: balanced.maximumFreezeMs,
      balancedRepeatedVsyncs: balanced.repeatedVsyncs,
      buffer3MaximumFreezeMs: buffer3.maximumFreezeMs,
      buffer3RepeatedVsyncs: buffer3.repeatedVsyncs,
    };
  });
}

function formatTable(result) {
  const rows = result.strategies.map((item) => ({
    strategy: item.name,
    unique: item.uniqueFramesDisplayed,
    dropped: item.droppedFrames,
    repeats: item.repeatedVsyncs,
    "repeat %": item.repeatPercent.toFixed(2),
    "max freeze ms": item.maximumFreezeMs.toFixed(2),
    "median latency ms": item.medianLatencyMs.toFixed(2),
    "p95 latency ms": item.p95LatencyMs.toFixed(2),
  }));
  console.log(`${result.profile}\n`);
  console.log(`Decoder arrivals: median ${result.decoder.medianArrivalGapMs} ms, p95 ${result.decoder.p95ArrivalGapMs} ms, max ${result.decoder.maximumArrivalGapMs} ms, >33 ms ${result.decoder.gapsOver33Ms}`);
  console.table(rows);
  console.log(`\nAssumption: ${result.assumptions.warning}`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const stringAfter = (name) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  };
  const numberAfter = (name, fallback) => {
    const value = stringAfter(name);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} requires a positive number`);
    return parsed;
  };
  const fixturePath = stringAfter("--fixture");
  const fixtureUrl = fixturePath ? pathToFileURL(resolve(fixturePath)) : defaultFixtureUrl;
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const legacyStallScale = stringAfter("--stall-scale");
  const options = {
    durationSeconds: numberAfter("--duration", fixture.stream.durationSeconds),
    seed: numberAfter("--seed", 901),
    schedulerScale:
      legacyStallScale === undefined
        ? numberAfter("--scheduler-scale", 1)
        : numberAfter("--stall-scale", 1),
    loadScale: numberAfter("--load-scale", 1),
  };
  if (args.includes("--sweep") || args.includes("--load-sweep")) {
    const sweep = runSweep(fixture, {
      ...options,
      parameter: args.includes("--load-sweep") ? "load" : "scheduler",
    });
    if (json) console.log(JSON.stringify(sweep, null, 2));
    else console.table(sweep);
    return;
  }
  const result = runSimulation(fixture, options);
  if (json) console.log(JSON.stringify(result, null, 2));
  else formatTable(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
