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
  sunshineApplicationTarget,
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

test("Sunshine launch prefers the stable media-clock app with fallbacks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-sunshine-app-test-"));
  const stable = join(directory, "Sunshine JMGO Media Clock.app");
  try {
    await writeFile(stable, "");
    assert.equal(
      await sunshineApplicationTarget("", [join(directory, "missing.app"), stable]),
      stable,
    );
    assert.equal(await sunshineApplicationTarget("Explicit App", []), "Explicit App");
    assert.equal(await sunshineApplicationTarget("", []), "Sunshine");
    assert.deepEqual(sunshineOpenArgs(stable), ["-n", stable]);
    assert.deepEqual(sunshineOpenArgs("Sunshine"), ["-a", "Sunshine"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("Sunshine installer preserves the stable media-clock identity", async () => {
  const installer = await readFile(
    join(process.cwd(), "experiments", "sunshine-jmgo", "install"),
    "utf8",
  );
  assert.match(
    installer,
    /destination=\$\{2:-\/Applications\/Sunshine JMGO Media Clock\.app\}/u,
  );
  assert.match(installer, /dev\.lizardbyte\.app\.Sunshine\.jmgo\.media/u);
  assert.match(installer, /JMGO_CODESIGN_IDENTITY/u);
});

test("Artemis shares host media time and paces absolute audio phase", async () => {
  const [patch, nativePatch, sunshinePatch] = await Promise.all([
    readFile(
      join(process.cwd(), "experiments", "artemis-jmgo", "artemis-v20.2.6.patch"),
      "utf8",
    ),
    readFile(
      join(process.cwd(), "experiments", "artemis-jmgo", "moonlight-common-c.patch"),
      "utf8",
    ),
    readFile(
      join(
        process.cwd(),
        "experiments",
        "sunshine-jmgo",
        "sunshine-v2026.726.710.patch",
      ),
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

  assert.equal(inputLeadMs, 125);
  assert.equal(inputLeadMs, Number(nativeInputLeadMatch[1]));
  assert.equal(decodedImages, integerConstant("DECODED_IMAGE_START_THRESHOLD"));
  assert.equal(preparedImages, integerConstant("PREPARED_IMAGE_QUEUE_LIMIT"));
  assert.equal(handoffLeadMs * 1_000_000, longConstant("PRESENTATION_HANDOFF_LEAD_NS"));
  assert.equal(
    inputLeadMs +
      ((decodedImages + preparedImages) * 1000) / framesPerSecond +
      handoffLeadMs,
    390,
  );

  assert.match(sunshinePatch, /media_epoch/u);
  assert.match(sunshinePatch, /capture_timestamp/u);
  assert.match(sunshinePatch, /timestamp_initialized/u);
  assert.match(
    sunshinePatch,
    /setAlwaysDiscardsLateVideoFrames:YES/u,
  );
  assert.match(sunshinePatch, /QOS_CLASS_USER_INTERACTIVE/u);
  assert.match(nativePatch, /LiGetCurrentAudioPresentationTime/u);
  assert.match(nativePatch, /currentAudioPresentationTimeMs = rtp->timestamp/u);
  assert.match(patch, /decodeUnit->presentationTimeMs/u);
  assert.match(patch, /submittedVideoMediaTimes\.put\(timestampUs \* 1000/u);
  assert.match(patch, /preparedImage\.mediaPresentationTimeMs/u);
  assert.match(patch, /public final class JmgoAvSyncClock/u);
  assert.match(
    patch,
    /measuredMediaOffsetNs = presentationTargetNs -/u,
  );
  assert.match(
    patch,
    /mediaPresentationTimeMs \* NANOS_PER_MILLISECOND/u,
  );
  assert.match(patch, /getAudioReleaseDeadlineNs\(/u);
  assert.match(patch, /JMGO_AUDIO_DEADLINE_MAXIMUM_STEP_NS = 100_000L/u);
  assert.match(patch, /expectedReleaseTimeNs = lastAudioReleaseTimeNs/u);
  assert.match(patch, /JmgoAvSyncClock\.updateAudioPresentation\(/u);
  assert.match(patch, /desiredPresentationNs - predictedPresentationNs/u);
  assert.equal(millisecondConstant("FALLBACK_AUDIO_SINK_LEAD_NS"), 300);
  assert.equal(
    millisecondConstant("MAXIMUM_AUDIO_WRITE_HOLDBACK_NS"),
    650,
  );
  assert.match(
    patch,
    /MAXIMUM_AUDIO_DEADLINE_CORRECTION_NS =\r?\n\+\s+250 \* NANOS_PER_MILLISECOND/u,
  );
  assert.equal(longConstant("PLAYBACK_SPEED_SCALE"), 1_000_000);
  assert.equal(longConstant("MINIMUM_PLAYBACK_SPEED"), 980_000);
  assert.equal(longConstant("MAXIMUM_PLAYBACK_SPEED"), 1_020_000);
  assert.equal(longConstant("MAXIMUM_PLAYBACK_SPEED_STEP"), 500);
  assert.equal(longConstant("PLAYBACK_SPEED_ERROR_DIVISOR"), 5_000);
  assert.equal(millisecondConstant("VIDEO_REBASE_THRESHOLD_NS"), 100);
  assert.equal(integerConstant("VIDEO_BASELINE_SAMPLES"), 60);
  assert.equal(integerConstant("AUDIO_PHASE_WARMUP_SAMPLES"), 8);
  assert.match(patch, /JmgoAvSyncClock\.reportAudioWriterWake\(/u);
  assert.match(patch, /track\.getTimestamp\(audioTimestamp\)/u);
  assert.match(patch, /if \(drainAudioQueue\) \{/u);
  assert.match(patch, /desiredSpeed = MAXIMUM_PLAYBACK_SPEED;/u);
  assert.match(patch, /PlaybackParams\.AUDIO_FALLBACK_MODE_DEFAULT/u);
  assert.match(patch, /\.setPitch\(1\.0f\)/u);
  assert.match(patch, /\.setSpeed\(speed\)/u);
  assert.match(patch, /JMGO media audio sync: timeline=/u);
  assert.match(patch, /JMGO latency telemetry: video holdback=/u);
  assert.match(patch, /FRAME_MARKER_SYNC = 0xA5/u);
  assert.match(patch, /decodeJmgoFrameMarker\(/u);
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
  assert.equal(integerConstant("DECODED_IMAGE_QUEUE_OFFER_TIMEOUT_MS"), 20);
  assert.match(
    patch,
    /decodedImageQueue\.offer\(decodedImage,\r?\n\+\s+DECODED_IMAGE_QUEUE_OFFER_TIMEOUT_MS, TimeUnit\.MILLISECONDS\)/u,
  );
  assert.match(
    patch,
    /decodedImageQueue\.size\(\) >= DECODED_IMAGE_QUEUE_LIMIT\) \{\r?\n\+\s+return;/u,
  );
  assert.doesNotMatch(patch, /Image oldest = decodedImageQueue\.poll\(\)/u);
  assert.doesNotMatch(patch, /getAudioRouteAdjustmentNs|AUDIO_ROUTE_BASELINE_SAMPLES/u);
  assert.doesNotMatch(patch, /releaseTimeNs = nowNs \+ JmgoAvSyncClock/u);
});
