import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildArtemisAppLaunchCommand,
  listSunshineApps,
  parseSunshineApps,
  parseSystemProfilerDisplays,
  readSunshineHostName,
  readSunshineMonitor,
  resolveMonitor,
  resolveSunshineApp,
  saveSunshineMinimumFps,
  saveSunshineMonitor,
  sunshineOpenArgs,
  updateSunshineMinimumFpsConfig,
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

test("Sunshine minimum FPS update replaces duplicates and validates bounds", () => {
  assert.equal(
    updateSunshineMinimumFpsConfig(
      "minimum_fps_target = 60\nhevc_mode = 1\nminimum_fps_target = 45\n",
      30,
    ),
    "minimum_fps_target = 30\nhevc_mode = 1\n",
  );
  assert.equal(updateSunshineMinimumFpsConfig("", 0), "minimum_fps_target = 0\n");
  assert.throws(() => updateSunshineMinimumFpsConfig("", -1), /invalid Sunshine minimum FPS/);
  assert.throws(() => updateSunshineMinimumFpsConfig("", 241), /invalid Sunshine minimum FPS/);
});

test("Sunshine app parsing exposes only ordered names", async () => {
  const document = JSON.stringify({
    env: { SECRET: "not returned" },
    apps: [
      { name: "Desktop", cmd: "sensitive command" },
      { name: "  Steam Big Picture  ", detached: ["private"] },
      { cmd: "missing name" },
    ],
  });
  const expected = [
    { index: 1, name: "Desktop" },
    { index: 2, name: "Steam Big Picture" },
  ];
  assert.deepEqual(parseSunshineApps(document), expected);

  const directory = await mkdtemp(join(tmpdir(), "jmgo-apps-test-"));
  try {
    const path = join(directory, "apps.json");
    await writeFile(path, document);
    assert.deepEqual(await listSunshineApps(path), expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Sunshine launch arguments distinguish app paths from registered names", () => {
  assert.deepEqual(sunshineOpenArgs("/Applications/Sunshine JMGO.app"), [
    "-n",
    "/Applications/Sunshine JMGO.app",
  ]);
  assert.deepEqual(sunshineOpenArgs("Sunshine"), ["-a", "Sunshine"]);
});

test("Sunshine app selection accepts exact names and one-based indexes", () => {
  const apps = parseSunshineApps('{"apps":[{"name":"Desktop"},{"name":"Steam Big Picture"}]}');
  assert.equal(resolveSunshineApp(apps, "desktop").index, 1);
  assert.equal(resolveSunshineApp(apps, "2").name, "Steam Big Picture");
  assert.throws(() => resolveSunshineApp(apps, "missing"), /unknown Sunshine app/);
  assert.throws(
    () => parseSunshineApps('{"apps":[{"name":"Desktop"},{"name":"desktop"}]}'),
    /duplicate Sunshine app name/,
  );
  assert.throws(
    () => resolveSunshineApp([...apps, { index: 3, name: "Desktop" }], "Desktop"),
    /ambiguous/,
  );
});

test("Sunshine host name honors configuration and has a safe fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-hostname-test-"));
  try {
    const path = join(directory, "sunshine.conf");
    await writeFile(path, 'sunshine_name = "Living Room Mac"\n');
    assert.equal(await readSunshineHostName(path, "fallback.local"), "Living Room Mac");
    assert.equal(await readSunshineHostName(join(directory, "missing"), "fallback.local"), "fallback.local");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Artemis named-app intent shell-quotes every external value", () => {
  assert.equal(
    buildArtemisAppLaunchCommand("Bob's Game; reboot", "Living Room Mac"),
    "am start -n 'com.limelight.noirdebug/com.limelight.ShortcutTrampoline' --es Name 'Living Room Mac' --es AppName 'Bob'\"'\"'s Game; reboot'",
  );
  assert.throws(() => buildArtemisAppLaunchCommand("bad\nname", "host"), /unsupported/);
});

test("Sunshine monitor save is atomic and private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-sunshine-test-"));
  const path = join(directory, "nested", "sunshine.conf");
  try {
    await writeFile(join(directory, "seed"), "unused");
    await saveSunshineMonitor("7", path);
    await saveSunshineMinimumFps(30, path);
    assert.equal(await readSunshineMonitor(path), "7");
    assert.equal(await readFile(path, "utf8"), "output_name = 7\nminimum_fps_target = 30\n");
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
