import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseSystemProfilerDisplays,
  readSunshineMonitor,
  resolveMonitor,
  saveSunshineMonitor,
  updateSunshineMonitorConfig,
} from "../src/artemis.js";

const profilerFixture = JSON.stringify({
  SPDisplaysDataType: [
    {
      spdisplays_ndrvs: [
        {
          _name: "Built-in Display",
          _spdisplays_displayID: "1",
          _spdisplays_pixels: "2940 x 1912",
          spdisplays_main: "spdisplays_yes",
          spdisplays_online: "spdisplays_yes",
        },
        {
          _name: "Studio Display",
          _spdisplays_displayID: "7",
          _spdisplays_resolution: "2560 x 1440 @ 60Hz",
          spdisplays_online: "spdisplays_yes",
        },
        {
          _name: "Offline Display",
          _spdisplays_displayID: "9",
          spdisplays_online: "spdisplays_no",
        },
      ],
    },
  ],
});

test("macOS monitor parsing returns active non-sensitive display fields", () => {
  assert.deepEqual(parseSystemProfilerDisplays(profilerFixture), [
    { id: "1", name: "Built-in Display", primary: true, resolution: "2940 x 1912" },
    { id: "7", name: "Studio Display", primary: false, resolution: "2560 x 1440 @ 60Hz" },
  ]);
});

test("monitor selection accepts primary, numeric ID, and exact name", () => {
  const monitors = parseSystemProfilerDisplays(profilerFixture);
  assert.equal(resolveMonitor(monitors, "primary").id, "1");
  assert.equal(resolveMonitor(monitors, "7").name, "Studio Display");
  assert.equal(resolveMonitor(monitors, "studio display").id, "7");
  assert.throws(() => resolveMonitor(monitors, "missing"), /unknown monitor/);
});

test("Sunshine monitor update replaces duplicates and preserves other options", () => {
  assert.equal(
    updateSunshineMonitorConfig(
      "hevc_mode = 1\noutput_name = 2\nminimum_fps_target = 60\noutput_name = 3\n",
      "7",
    ),
    "hevc_mode = 1\noutput_name = 7\nminimum_fps_target = 60\n",
  );
  assert.equal(updateSunshineMonitorConfig("hevc_mode = 1\n", "1"), "hevc_mode = 1\noutput_name = 1\n");
  assert.throws(() => updateSunshineMonitorConfig("", "DP-1"), /invalid monitor ID/);
});

test("Sunshine monitor save is atomic and private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-sunshine-test-"));
  const path = join(directory, "nested", "sunshine.conf");
  try {
    await writeFile(join(directory, "seed"), "unused");
    await saveSunshineMonitor("7", path);
    assert.equal(await readSunshineMonitor(path), "7");
    assert.equal(await readFile(path, "utf8"), "output_name = 7\n");
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
