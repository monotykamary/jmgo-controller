#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [path, packageName = "com.limelight.noirdebug"] = process.argv.slice(2);
if (!path) {
  console.error("Usage: parse-timestats.mjs FILE [PACKAGE]");
  process.exit(2);
}
const raw = await readFile(path, "utf8");
const marker = `layerName = SurfaceView - ${packageName}/com.limelight.Game#0`;
const start = raw.indexOf(marker);
if (start < 0) throw new Error(`video layer missing: ${marker}`);
const block = raw.slice(start).split(/\n\s*\n/, 1)[0] ?? "";
function integer(name) {
  const match = block.match(new RegExp(`${name} = (\\d+)`));
  if (!match) throw new Error(`${name} missing`);
  return Number(match[1]);
}
const averageMatch = block.match(/averageFPS = ([0-9.]+)/);
const histogramMatch = block.match(/present2present histogram is as below:\n([^\n]+)/);
if (!averageMatch || !histogramMatch) throw new Error("FPS histogram missing");
const bins = [...histogramMatch[1].matchAll(/(\d+)ms=(\d+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
const intervals = bins.reduce((sum, [, count]) => sum + count, 0);
const normalIntervals = bins.filter(([ms]) => ms >= 15 && ms <= 18).reduce((sum, [, count]) => sum + count, 0);
const longGaps = bins.filter(([ms]) => ms >= 34).reduce((sum, [, count]) => sum + count, 0);
const populated = bins.filter(([, count]) => count > 0);
const result = {
  totalFrames: integer("totalFrames"),
  averageFPS: Number(averageMatch[1]),
  intervals,
  normalIntervals,
  normalPercent: intervals === 0 ? 0 : Number((normalIntervals * 100 / intervals).toFixed(3)),
  longGapsAtLeast34ms: longGaps,
  maximumIntervalMs: populated.length === 0 ? null : Math.max(...populated.map(([ms]) => ms)),
  droppedFrames: integer("droppedFrames"),
  lateAcquireFrames: integer("lateAcquireFrames"),
  badDesiredPresentFrames: integer("badDesiredPresentFrames"),
};
const passed = result.intervals > 0 && result.normalIntervals === result.intervals && result.longGapsAtLeast34ms === 0 && result.droppedFrames === 0 && result.lateAcquireFrames === 0 && result.badDesiredPresentFrames === 0;
console.log(JSON.stringify({ ...result, passed }));
if (!passed) process.exitCode = 1;
