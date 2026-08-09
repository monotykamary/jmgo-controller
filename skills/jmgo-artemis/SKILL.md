---
name: jmgo-artemis
description: >-
  Build, install, configure, and open the hardware-certified JMGO Artemis Lab
  Moonlight client; list/select the local Sunshine monitor or application and
  restart Sunshine before launch to clear orphaned sessions and avoid the empty popup.
  Use for continuously smooth 720p60 or 1080p60 H.264 streaming on JMGO S901.
  Requires jmgo, ADB, Sunshine on macOS, and the projector on the same LAN.
setup: bash scripts/setup
compatibility: >-
  macOS Sunshine host, Node.js 20+, jmgo-controller, Android Platform Tools, and
  JMGO Artemis Lab (com.limelight.noirdebug). Building additionally needs JDK 21,
  Android platform 36/build-tools 37, and NDK 27.0.12077973.
---

# JMGO Artemis Lab

`jmgo-artemis` opens only the certified package `com.limelight.noirdebug`. It restarts Sunshine first by default; this clears an orphaned Desktop session that otherwise produces an empty popup when reconnecting. When `/Applications/Sunshine JMGO.app` exists, it is preferred automatically. Every launch also stops `com.jmgo.setting.x`, whose background Wi-Fi scan caused a measured 450 ms outage.

## Open safely

```bash
jmgo-artemis
jmgo-artemis open
```

Skip restart only when preserving an active host session is deliberate:

```bash
jmgo-artemis --no-restart
```

If the empty Desktop chooser appears, exit it and rerun without `--no-restart`.

## Choose the streamed monitor

```bash
jmgo-artemis monitors
jmgo-artemis monitors --json
jmgo-artemis --monitor primary
jmgo-artemis --monitor 7
jmgo-artemis --monitor "Studio Display"
jmgo-artemis --minimum-fps 30 --monitor primary --app "Desktop"
```

Monitor selection updates only `output_name` in the private Sunshine configuration. `--minimum-fps 30` persists the certified smoothness floor without exposing other Sunshine settings. Both options require restart. Numeric monitor IDs come from macOS `system_profiler`; names match exactly, case-insensitively.

## Choose a Sunshine application

```bash
jmgo-artemis apps
jmgo-artemis apps --json
jmgo-artemis --app 1
jmgo-artemis --app "Desktop"
jmgo-artemis --monitor primary --app "Steam Big Picture"
```

`apps` emits only one-based indexes and names from Sunshine `apps.json`; it never returns commands, environment variables, or prep scripts. `--app` starts the matching entry directly through Artemis's shortcut activity without host/app-grid taps. Use `--pc "NAME"` only if the paired host differs from Sunshine's configured name or the local hostname. If an entry was just added, open the host once in Artemis to refresh its app cache.

Application selection launches one Sunshine entry, but capture remains monitor-based rather than restricted to one macOS window.

## Certified client profile

- Resolution: 1280×720 or 1920×1080
- Frame rate: 60 FPS
- Frame pacing: Balanced
- Codec: H.264
- Sunshine: patched `v2026.726.710`, `minimum_fps_target = 30`
- Client input reserve: 150 ms; decoded startup threshold: 10 images; copy-ready start: 5 images
- Client burst capacity: 15 decoded images; ImageReader ownership capacity: 17 images
- 1080p tested bitrate: 14,988,000 bit/s

Do not switch to latency-focused frame pacing: it bypasses the image ring that fixes JMGO's decoder-output batching. The patched Balanced path uses 150 ms of encoded-input lead, starts preparation after ten decoded images, begins its fixed-period timer with five copy-ready images, retains a 15-image burst limit, requests a 200 ms AudioTrack for HAL-stall tolerance, and applies a separate calculated 400 ms timestamped speaker holdback. Do not restore Sunshine's 60 FPS floor: it overproduced closely timed decoded images and caused silent content-frame replacement even while SurfaceFlinger looked perfect. Do not open projector Settings during a certification run because it can restart the Wi-Fi scanner.

## Build and install

Read [references/build-and-deploy.md](references/build-and-deploy.md) before rebuilding. Read [references/architecture.md](references/architecture.md) before changing pacing, audio, crop, or JNI code.

Use the `jmgo-stream-test` skill for the nonintrusive SurfaceFlinger certification and the complete hitch investigation.
