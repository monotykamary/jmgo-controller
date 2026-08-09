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
jmgo-stream-test --host PROJECTOR_HOST --duration 20 --focus-mode interactive
jmgo-stream-test --host PROJECTOR_HOST --duration 60
jmgo-stream-test --host PROJECTOR_HOST --monitor 4 --duration 300 --focus-mode controlled
jmgo-stream-test --serial PROJECTOR_HOST:5555 --no-audio
jmgo-stream-test --host PROJECTOR_HOST --screenshot /tmp/jmgo-result.png
jmgo-stream-test freeze-report --host PROJECTOR_HOST --monitor 4
```

Defaults:

- 60 seconds
- high-detail 60 FPS motion asset
- quiet 48 kHz stereo PCM tone
- package `com.limelight.noirdebug`
- motion source placed on Sunshine’s configured `output_name` display (override with `--monitor ID`)
- interactive focus mode, which immediately restores the previously active application
- source acceptance from before/after Safari rAF counters: 55–65 FPS, 90–110% timed-span coverage, no ≥34 ms source gap, and a title no more than 500 ms stale
- strict acceptance: every interval 15–18 ms, no interval ≥34 ms, no compositor drops, no known pipeline fault, and—on audio runs of at least 20 seconds—no route divergence, persistent speed saturation, pressure drain, or near-capacity PCM queue

When an existing Desktop stream appears frozen, stop changing its pixels and run `freeze-report` **before any restart**. It creates no window and changes no pixels. After a two-second settle it privately captures the selected host display and one projector compositor frame, scales them, classifies SSIM ≥0.90 as matching, correlates three minutes of VideoToolbox input/encode/transmit rates, and deletes both images. The single ADB screencap is intrusive, so this is one-shot failure forensics rather than cadence evidence. `downstream-view-stale` means the host encoder observed a significant content change while the projector retained different pixels.

Before timing, the script records the frontmost application, resolves the selected CoreGraphics display, creates a dedicated Safari window, verifies the motion-asset URL, and moves that exact window wholly onto the display. `--focus-mode interactive` immediately restores the prior application and independently requires healthy source rAF. `--focus-mode controlled` keeps Safari foreground, requires Safari to be frontmost at both timed boundaries, and rejects reported blur or hidden events; cleanup restores the original application in either mode. A one-second SurfaceFlinger preflight rejects stale Game activities before the real timer. Cleanup closes only the tracked test window. This is mandatory when Sunshine captures a virtual display; motion or tab changes on the Mac’s main display do not exercise the streamed pixels. It then force-stops `com.jmgo.setting.x`, whose background Wi-Fi scan caused a measured 450 ms outage. It then performs **no ADB work during the timed sleep**. Do not reopen projector Settings or add `top`, screenshots, log polling, or progress probes in the measurement window; either can perturb the same projector Wi-Fi path.

## Assets

- `assets/simple-motion.html` — exact early CSS bar used to expose the original periodic hitch.
- `assets/high-detail-motion.html` — final checker/grid and fast-edge 1080p stress page; publishes rAF/focus/visibility counters in its title and draws a 16-bit frame marker into captured pixels.
- `assets/latency-clock.html` — binary host clock for qualitative latency experiments only; repeated ADB screenshots are intrusive and must not be used as cadence evidence.

## Interpretation

A passing build must show zero:

- timed source rAF gaps ≥34 ms; controlled mode also requires zero focus-loss and hidden events
- network frame/audio drops
- encoded queue overflows
- ≥50 ms input-pacing lateness
- MediaCodec input stalls
- decoded image queue replacements
- decoded image-ring empties or timer delays
- any `JMGO video starvation` detection, IDR/codec recovery, worker restart, or stream reconnect; self-healing is correct ordinary-use behavior but still invalidates a clean certification window
- ImageReader/ImageWriter faults
- audio queue drops, write failures, legacy backlogs, route/video tail error above 75 ms, persistent ±2% speed saturation, pressure-drain activation, or queued audio reaching 1,100 ms
- projector `WifiTracker` scans during the timed window
- SurfaceFlinger dropped, late-acquire, or bad-desired-present frames

Read [references/e2e-certification.md](references/e2e-certification.md) for the protocol and [references/hitch-investigation.md](references/hitch-investigation.md) before changing encoder, network, decoder, pacing, or audio behavior. Historical sanitized measurements are in [references/measurements.json](references/measurements.json).
