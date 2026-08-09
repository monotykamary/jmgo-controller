# Build and deploy JMGO Artemis Lab

## Requirements

- JDK 21
- Android platform 36
- Android build-tools 37
- NDK `27.0.12077973`
- Git and network access for pinned public sources and Gradle dependencies
- Android Platform Tools for installation
- CMake, Ninja, Boost, miniupnpc, Node.js, and pkg-config for the patched Sunshine host

On Homebrew macOS the build script detects `openjdk@21` and `android-commandlinetools`. Otherwise set `JAVA_HOME` and `ANDROID_HOME`.

## Reproducible build

From a jmgo-controller checkout:

```bash
bash experiments/artemis-jmgo/build
```

The builder refuses to overwrite its work directory, clones immutable parent and submodule commits, applies both patches with `--check`, compiles every ABI, and prints the APK path and SHA-256.

Choose a fresh directory when needed:

```bash
bash experiments/artemis-jmgo/build /tmp/artemis-jmgo-build
```

A debug APK hash can vary with signing metadata; source revisions, patch application, and behavior are the reproducibility boundary.

Build and install the pinned macOS capture host separately:

```bash
bash experiments/sunshine-jmgo/build
bash experiments/sunshine-jmgo/install
open -n "/Applications/Sunshine JMGO.app"
```

Enable **Sunshine JMGO** under **Privacy & Security → Screen & System Audio Recording**. Its ad-hoc code hash is the TCC identity, so do not replace or re-sign an authorized build. See `experiments/sunshine-jmgo/README.md`.

## Install

```bash
jmgo adb install /tmp/artemis-jmgo-build/app/build/outputs/apk/nonRoot_game/debug/app-nonRoot_game-debug.apk
jmgo adb packages limelight
```

Keep only `com.limelight.noirdebug`. Remove stock Moonlight or old experiment packages only after confirming their exact names:

```bash
jmgo adb uninstall com.limelight
jmgo adb uninstall com.limelight.noir
jmgo adb uninstall com.limelight.noiraudiotest
```

Never commit APKs, projector screenshots, local IPs, signing stores, Android credentials, or Sunshine credentials.

## Open with the smoothness profile

```bash
jmgo artemis monitors
jmgo artemis --minimum-fps 30 --monitor 4 --app Desktop
```

The command updates only Sunshine's `output_name` and `minimum_fps_target`, automatically prefers `/Applications/Sunshine JMGO.app`, restarts Sunshine to clear stale sessions, force-stops the projector Settings scanner and certified client, and starts Desktop directly. The 30 FPS floor avoids supplemental decoded images during active 60 FPS capture. Do not reopen projector Settings while streaming.

## Required direct probes

After connecting, verify logcat contains:

```text
width=1920 ... height=1080 ... frame-rate=60
JMGO input pacing started with 150 ms lead
JMGO timer pacing started with 5 prepared frame available before VSync
Audio track configuration: 38400 true
```

A build is not acceptance. Run the `jmgo-stream-test` skill without any midpoint ADB command and require a 60-second gate plus a five-minute run with perfect cadence and zero diagnostic faults. This includes zero decoded-image replacement, Wi-Fi scan, network-drop, prepared-queue-empty, compositor, and audio lines.
