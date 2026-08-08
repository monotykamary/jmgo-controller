# Build and deploy JMGO Artemis Lab

## Requirements

- JDK 21
- Android platform 36
- Android build-tools 37
- NDK `27.0.12077973`
- Git and network access for pinned public sources and Gradle dependencies
- Android Platform Tools for installation

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

## Open and select a monitor

```bash
jmgo artemis monitors
jmgo artemis --monitor primary
```

The command updates Sunshine's `output_name`, restarts Sunshine to clear stale sessions, force-stops the certified package, and launches it. Select Desktop in Artemis after Sunshine is ready.

## Required direct probes

After connecting, verify logcat contains:

```text
width=1920 ... height=1080 ... frame-rate=60
JMGO input pacing started with 0 ms lead
JMGO timer pacing started with 1 decoded frame available
Audio track configuration: 1920 true
```

A build is not acceptance. Run the `jmgo-stream-test` skill without any midpoint ADB command and require perfect cadence plus zero diagnostic faults.
