---
name: jmgo-artemis
description: >-
  Build, install, configure, and open the hardware-certified JMGO Artemis Lab
  Moonlight client; list/select the local Sunshine monitor and restart Sunshine
  before launch to clear orphaned Desktop sessions and avoid the empty popup.
  Use for hitch-free low-latency 720p60 or 1080p60 H.264 streaming on JMGO S901.
  Requires jmgo, ADB, Sunshine on macOS, and the projector on the same LAN.
setup: bash scripts/setup
compatibility: >-
  macOS Sunshine host, Node.js 20+, jmgo-controller, Android Platform Tools, and
  JMGO Artemis Lab (com.limelight.noirdebug). Building additionally needs JDK 21,
  Android platform 36/build-tools 37, and NDK 27.0.12077973.
---

# JMGO Artemis Lab

`jmgo-artemis` opens only the certified package `com.limelight.noirdebug`. It restarts Sunshine first by default; this clears an orphaned Desktop session that otherwise produces an empty popup when reconnecting.

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
```

Monitor selection updates only `output_name` in the private Sunshine configuration and requires restart. Numeric IDs come from macOS `system_profiler`; names must match exactly, case-insensitively.

## Certified client profile

- Resolution: 1280×720 or 1920×1080
- Frame rate: 60 FPS
- Frame pacing: Balanced
- Codec: H.264
- Sunshine: `minimum_fps_target = 60`
- 1080p tested bitrate: 14,988,000 bit/s

Do not switch to latency-focused frame pacing: it bypasses the image ring that fixes JMGO's decoder-output batching. The patched Balanced path already uses zero artificial input lead, presentation on the first decoded image, and a 10 ms AudioTrack.

## Build and install

Read [references/build-and-deploy.md](references/build-and-deploy.md) before rebuilding. Read [references/architecture.md](references/architecture.md) before changing pacing, audio, crop, or JNI code.

Use the `jmgo-stream-test` skill for the nonintrusive SurfaceFlinger certification and the complete hitch investigation.
