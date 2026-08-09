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

test("Artemis A/V clock slews audio from measured video presentation", async () => {
  const [patch, nativePatch] = await Promise.all([
    readFile(
      join(process.cwd(), "experiments", "artemis-jmgo", "artemis-v20.2.6.patch"),
      "utf8",
    ),
    readFile(
      join(process.cwd(), "experiments", "artemis-jmgo", "moonlight-common-c.patch"),
      "utf8",
    ),
  ]);
  const integerConstant = (name: string): number => {
    const match = patch.match(new RegExp(`${name} = (\\d+);`, "u"));
    assert.ok(match?.[1], `missing ${name}`);
    return Number(match[1]);
  };
  const longConstant = (name: string): number => {
    const match = patch.match(new RegExp(`${name} = ([\\d_]+)L;`, "u"));
    assert.ok(match?.[1], `missing ${name}`);
    return Number(match[1].replaceAll("_", ""));
  };
  const millisecondConstant = (name: string): number => {
    const match = patch.match(
      new RegExp(`${name} = (\\d+) \\* NANOS_PER_MILLISECOND;`, "u"),
    );
    assert.ok(match?.[1], `missing ${name}`);
    return Number(match[1]);
  };

  const inputLeadMs = millisecondConstant("VIDEO_INPUT_LEAD_NS");
  const decodedImages = integerConstant("FALLBACK_DECODED_IMAGES");
  const preparedImages = integerConstant("FALLBACK_PREPARED_IMAGES");
  const framesPerSecond = integerConstant("STREAM_FRAMES_PER_SECOND");
  const handoffLeadMs = millisecondConstant("PRESENTATION_HANDOFF_LEAD_NS");
  const nativeInputLeadMatch = nativePatch.match(/presentationLeadMs = (\d+);/u);
  assert.ok(nativeInputLeadMatch?.[1], "missing native presentation lead");

  assert.equal(inputLeadMs, Number(nativeInputLeadMatch[1]));
  assert.equal(decodedImages, integerConstant("DECODED_IMAGE_START_THRESHOLD"));
  assert.equal(preparedImages, integerConstant("PREPARED_IMAGE_QUEUE_LIMIT"));
  assert.equal(handoffLeadMs * 1_000_000, longConstant("PRESENTATION_HANDOFF_LEAD_NS"));
  assert.equal(
    inputLeadMs +
      ((decodedImages + preparedImages) * 1000) / framesPerSecond +
      handoffLeadMs,
    415,
  );

  assert.match(patch, /public final class JmgoAvSyncClock/u);
  assert.match(
    patch,
    /long measuredHoldbackNs = VIDEO_INPUT_LEAD_NS \+\r?\n\+\s+presentationTargetNs - sourceTimestampNs;/u,
  );
  assert.match(
    patch,
    /preparedImage\.sourceTimestampNs,\r?\n\+\s+nextReleaseNs \+ PRESENTATION_HANDOFF_LEAD_NS/u,
  );
  assert.match(
    patch,
    /releaseTimeNs = nowNs \+ JmgoAvSyncClock\.getAudioHoldbackNs\(\)/u,
  );
  assert.match(
    patch,
    /frame\.releaseTimeNs = Math\.max\(releaseTimeNs, lastAudioReleaseTimeNs \+ 1\)/u,
  );
  assert.match(patch, /MAXIMUM_SCHEDULER_COMPENSATION_NS = 20 \*/u);
  assert.equal(longConstant("PLAYBACK_SPEED_SCALE"), 1_000_000);
  assert.equal(longConstant("MINIMUM_PLAYBACK_SPEED"), 980_000);
  assert.equal(longConstant("MAXIMUM_PLAYBACK_SPEED"), 1_020_000);
  assert.equal(longConstant("MAXIMUM_PLAYBACK_SPEED_STEP"), 500);
  assert.equal(longConstant("PLAYBACK_SPEED_ERROR_DIVISOR"), 5_000);
  assert.match(
    patch,
    /MINIMUM_AUDIO_ROUTE_ADJUSTMENT_NS =\r?\n\+\s+-2 \* NANOS_PER_SECOND/u,
  );
  assert.match(
    patch,
    /MAXIMUM_AUDIO_ROUTE_ADJUSTMENT_NS =\r?\n\+\s+2 \* NANOS_PER_SECOND/u,
  );
  assert.equal(millisecondConstant("VIDEO_REBASE_THRESHOLD_NS"), 100);
  assert.equal(integerConstant("VIDEO_BASELINE_SAMPLES"), 60);
  assert.equal(integerConstant("AUDIO_ROUTE_BASELINE_SAMPLES"), 64);
  assert.match(patch, /JmgoAvSyncClock\.reportAudioWriterWake\(/u);
  assert.match(patch, /track\.getTimestamp\(audioTimestamp\)/u);
  assert.match(patch, /JmgoAvSyncClock\.updateAudioRouteLead\(/u);
  assert.match(
    patch,
    /audioRouteBaselineSamples\.get\(\) >= AUDIO_ROUTE_BASELINE_SAMPLES/u,
  );
  assert.match(
    patch,
    /getAudioPlaybackSpeed\(long nowNs,\r?\n\+\s+boolean drainAudioQueue\)/u,
  );
  assert.match(patch, /if \(drainAudioQueue\) \{/u);
  assert.match(patch, /desiredSpeed = MAXIMUM_PLAYBACK_SPEED;/u);
  assert.match(
    patch,
    /return \(float\) speed \/ PLAYBACK_SPEED_SCALE/u,
  );
  assert.match(patch, /getCurrentAudioPlaybackSpeed\(\)/u);
  assert.match(patch, /PlaybackParams\.AUDIO_FALLBACK_MODE_DEFAULT/u);
  assert.match(patch, /\.setPitch\(1\.0f\)/u);
  assert.match(patch, /\.setSpeed\(speed\)/u);
  assert.match(
    patch,
    /long holdbackNs = BASELINE_HOLDBACK_NS - schedulerCompensationNs\.get\(\)/u,
  );
  assert.match(
    patch,
    /return videoHoldbackNs\.get\(\) - baselineHoldbackNs/u,
  );
  assert.match(
    patch,
    /measuredHoldbackNs \+ baselineHoldbackNs - previousHoldbackNs/u,
  );
  assert.match(patch, /if \(nowNs < nextReleaseNs\)/u);
  assert.match(patch, /long schedulerDelayNs = nowNs - nextReleaseNs/u);
  assert.match(patch, /JMGO_AUDIO_QUEUE_FRAMES = 256;/u);
  assert.equal(integerConstant("JMGO_AUDIO_QUEUE_DRAIN_FRAMES"), 220);
  assert.ok(
    integerConstant("JMGO_AUDIO_QUEUE_DRAIN_FRAMES") <
      integerConstant("JMGO_AUDIO_QUEUE_FRAMES"),
  );
  assert.match(patch, /audioPacketDurationNs = samplesPerFrame \* 1_000_000_000L/u);
  assert.match(patch, /readyAudioFrames\.size\(\) \* audioPacketDurationNs/u);
  assert.match(patch, /getAudioQueueLeadNs\(\)/u);
  assert.match(patch, /getAudioRouteAdjustmentNs\(\)/u);
  assert.match(
    patch,
    /readyAudioFrames\.size\(\) >= JMGO_AUDIO_QUEUE_DRAIN_FRAMES/u,
  );
  assert.equal(integerConstant("DECODED_IMAGE_QUEUE_OFFER_TIMEOUT_MS"), 20);
  assert.match(
    patch,
    /decodedImageQueue\.offer\(image,\r?\n\+\s+DECODED_IMAGE_QUEUE_OFFER_TIMEOUT_MS, TimeUnit\.MILLISECONDS\)/u,
  );
  assert.match(
    patch,
    /decodedImageQueue\.size\(\) >= DECODED_IMAGE_QUEUE_LIMIT\) \{\r?\n\+\s+return;/u,
  );
  assert.doesNotMatch(patch, /Image oldest = decodedImageQueue\.poll\(\)/u);
  assert.doesNotMatch(patch, /MINIMUM_SINK_ADJUSTMENT_NS|MAXIMUM_SINK_ADJUSTMENT_NS/u);
  assert.doesNotMatch(patch, /JMGO_AUDIO_SYNC_DELAY_NS/u);
  assert.doesNotMatch(patch, /reportAudioWriteCompletion/u);
  assert.doesNotMatch(patch, /VIDEO_DISCONTINUITY_NS/u);
  assert.doesNotMatch(patch, /adjustedReleaseNs|presentationAdjustmentNs/u);
});
