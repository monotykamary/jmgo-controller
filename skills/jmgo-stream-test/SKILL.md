---
name: jmgo-stream-test
description: >-
  Certify JMGO Artemis streaming end to end with saved motion HTML, optional
  48 kHz stereo audio, SurfaceFlinger timestats, and logcat fault accounting.
  Use when investigating periodic hitching, validating 720p60/1080p60 after a
  build or setting change, comparing latency variants, or proving no transport,
  decoder, image-ring, compositor, or audio regression. Requires an active JMGO
  Artemis Lab stream and performs a deliberately nonintrusive timed run.
setup: bash scripts/setup
compatibility: >-
  macOS host with Safari, Node.js 20+, adb, ffmpeg, afplay, and an active
  com.limelight.noirdebug stream on the projector. SurfaceFlinger timestats must
  be available. The default test changes the visible host page and plays a quiet tone.
---

# JMGO stream certification

Run only after `jmgo-artemis --minimum-fps 30 --app Desktop` has opened the certified client and Desktop is actively streaming.

```bash
jmgo-stream-test --host PROJECTOR_HOST
jmgo-stream-test --host PROJECTOR_HOST --duration 60
jmgo-stream-test --host PROJECTOR_HOST --monitor 4 --duration 300
jmgo-stream-test --serial PROJECTOR_HOST:5555 --no-audio
jmgo-stream-test --host PROJECTOR_HOST --screenshot /tmp/jmgo-result.png
```

Defaults:

- 60 seconds
- high-detail 60 FPS motion asset
- quiet 48 kHz stereo PCM tone
- package `com.limelight.noirdebug`
- motion source placed on Sunshine’s configured `output_name` display (override with `--monitor ID`)
- strict acceptance: every interval 15–18 ms, no interval ≥34 ms, no compositor drops, no known pipeline fault, and—on audio runs of at least 20 seconds—no route divergence, persistent speed saturation, pressure drain, or near-capacity PCM queue

Before timing, the script records the frontmost application, resolves the selected CoreGraphics display, creates a dedicated Safari window, immediately restores the prior application after each required Safari activation, verifies the motion-asset URL, and moves that exact window wholly onto the display. Cleanup closes only the tracked test window. This is mandatory when Sunshine captures a virtual display; motion or tab changes on the Mac’s main display do not exercise the streamed pixels. It then force-stops `com.jmgo.setting.x`, whose background Wi-Fi scan caused a measured 450 ms outage. It then performs **no ADB work during the timed sleep**. Do not reopen projector Settings or add `top`, screenshots, log polling, or progress probes in the measurement window; either can perturb the same projector Wi-Fi path.

## Assets

- `assets/simple-motion.html` — exact early CSS bar used to expose the original periodic hitch.
- `assets/high-detail-motion.html` — final checker/grid and fast-edge 1080p stress page.
- `assets/latency-clock.html` — binary host clock for qualitative latency experiments only; repeated ADB screenshots are intrusive and must not be used as cadence evidence.

## Interpretation

A passing build must show zero:

- network frame/audio drops
- encoded queue overflows
- ≥50 ms input-pacing lateness
- MediaCodec input stalls
- decoded image queue replacements
- decoded image-ring empties or timer delays
- ImageReader/ImageWriter faults
- audio queue drops, write failures, legacy backlogs, route/video tail error above 75 ms, persistent ±2% speed saturation, pressure-drain activation, or queued audio reaching 1,100 ms
- projector `WifiTracker` scans during the timed window
- SurfaceFlinger dropped, late-acquire, or bad-desired-present frames

Read [references/e2e-certification.md](references/e2e-certification.md) for the protocol and [references/hitch-investigation.md](references/hitch-investigation.md) before changing encoder, network, decoder, pacing, or audio behavior. Historical sanitized measurements are in [references/measurements.json](references/measurements.json).
