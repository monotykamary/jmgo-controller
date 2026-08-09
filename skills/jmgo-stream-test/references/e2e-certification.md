# End-to-end certification protocol

## Acceptance ledger

A release is complete only when all checks pass:

1. The installed package is `com.limelight.noirdebug`; old stock/experiment packages are absent.
2. Artemis negotiates H.264 at the requested 1280×720 or 1920×1080 and 60 FPS.
3. Logs show 150 ms input lead, decoded and five-image prepared queue depths at timer start, a 38,400-byte stereo AudioTrack request, and `JMGO dynamic audio sync enabled with 415 ms audio baseline` followed by periodic holdback, scheduler compensation, sink lead, queued audio, route change, queue-drain, video-depth, and playback-speed telemetry. On the built-in speaker route, AudioFlinger should report 9,600 frames and zero underruns; its variable latency column is not the A/V synchronization clock.
4. Patched Sunshine JMGO reports the expected monitor, bitrate, and `minimum_fps_target = 30`; the application firewall permits its LAN traffic. The motion page must be in the dedicated Safari window on that same monitor. Before/after title snapshots must show 55–65 source rAF FPS, 90–110% timed-span coverage, zero timed ≥34 ms source gaps, and a final sample no more than 500 ms stale. Controlled runs additionally require Safari frontmost at both timed boundaries plus zero reported blur and hidden events.
5. A high-detail motion run with continuous 48 kHz stereo audio has 100% 15–18 ms intervals and maximum 17–18 ms.
6. SurfaceFlinger dropped, late-acquire, and bad-desired-present counts are zero.
7. Transport, Wi-Fi scan, decoder, decoded-image replacement, image-ring, writer/reader, scheduler, and audio fault counts are zero.
8. A normalized screenshot has no green/uninitialized region and correct crop/aspect.
9. A zero-source-offset flash/click animation is rendered natively on the exact Sunshine monitor and is acceptably synchronized through the built-in speaker.
10. The saved patches apply to a fresh immutable clone and all ABI builds succeed.
11. Project checks, tests, shell syntax, skill smoke tests, package contents, and secret scans pass.

## Procedure

1. Build through `experiments/artemis-jmgo/build`; never certify a hand-edited temporary tree alone.
2. Install the fresh-clone APK.
3. Run `jmgo-artemis --minimum-fps 30 --monitor 4 --app Desktop` for the certified virtual display, or choose the actual intended monitor/application. This prefers Sunshine JMGO and stops the projector Settings scanner.
4. Verify the Game activity is foreground and do not reopen projector Settings.
5. Run `pnpm simulate:avsync`, then `jmgo-stream-test --host HOST --monitor 4 --duration 20 --focus-mode interactive` for fast coexistence feedback and `--duration 60` for the ordinary hardware gate. Certify the final candidate with one idle `--duration 300 --focus-mode controlled` soak. Interactive mode restores the prior app but still rejects source throttling; controlled mode leaves Safari foreground, requires it at both timed boundaries, and rejects reported blur or hidden events. Both restore the original app during cleanup.
6. Do nothing else during the definitive controlled five-minute sleep. An interactive-machine pass is a separate stress test because foreground applications share WindowServer, GPU, capture, encoder, and network resources; it cannot be relabeled as controlled certification.
7. Treat any long gap or fault event as failure; inspect timestamps before rerunning.
8. Use `--screenshot /tmp/result.png` only after timing. If an already-idle Desktop stream appears frozen, make the view static and run `jmgo-stream-test freeze-report --host HOST --monitor 4` once before restarting anything.

## Why SurfaceFlinger

The rendered layer's present-to-present histogram observes what actually reaches the projector compositor. Client FPS counters can report decode or receive activity while the visible Surface repeats an old buffer. Safari title deltas independently prove that the source generated fresh 55–65 FPS rAF work, and the page draws a 16-bit frame marker into captured pixels. The current gate does not yet decode that marker at the projector, so host capture duplication remains a narrower residual blind spot; decoded queue replacement is independently fatal. The target layer is:

```text
SurfaceView - com.limelight.noirdebug/com.limelight.Game#0
```

## Long-idle freeze report

`freeze-report` does not open Safari or alter the desktop. It waits two seconds, captures the configured CoreGraphics display and one projector compositor PNG, compares them at projector resolution, samples the preceding three minutes of macOS VideoToolbox rates from unified logging, emits only sanitized metrics, and deletes both images. Use it only on a settled desktop: motion between the host capture and the slower ADB screencap can create a false mismatch. A view SSIM of at least 0.90 is calibrated as matching; `downstream-view-stale` requires both a mismatch and healthy ≥50 FPS host capture with a significant bitrate excursion. One ADB screencap is intrusive and cannot be used as cadence evidence.

## Diagnostic patterns

The test rejects log lines containing:

- source rAF gap ≥34 ms, stale source telemetry, or source rate outside 55–65 FPS
- controlled-mode source blur or hidden event
- encoded queue overflow
- network frame/audio drop
- `WifiTracker` scan during the timed interval
- MediaCodec input dequeue stall
- ≥50 ms input pacing lateness
- decoded image queue replacement
- decoded image-ring empty
- timer scheduler delay
- any video-starvation transition, recovery IDR, codec restart, preparation-worker restart, or Game reconnect
- ImageReader stall or ImageWriter rejection
- audio queue drop or AudioTrack write failure
- legacy pending-audio backlog
- queued audio at or above 1,100 ms or any pressure-drain sample
- more than 75 ms of tail route/video error
- playback pinned near 0.98 or 1.02 for all three tail samples
- fatal exception

## Source freshness

The high-detail page publishes cumulative frame, elapsed-time, ≥34 ms gap, blur, hidden, and last-frame epoch counters in its title every fifteen frames. The runner snapshots the title immediately before and after the same timed sleep used for SurfaceFlinger. It compares counter deltas, so setup activation is excluded. Interactive mode allows Safari to remain background only when measured rAF still passes; controlled mode requires Safari at both boundaries and treats reported focus or visibility loss as invalid. The page also encodes the low sixteen frame-counter bits in a magenta-bordered black/white strip for future end-to-end pixel-sequence decoding.

The runner performs a one-second presentation preflight before baselining source counters. A resumed `Game` activity without new SurfaceFlinger buffers is rejected immediately instead of consuming a long test window. No ADB command runs during the actual sleep. Source and A/V JSON results include `failureReasons`, so source rate/gap/focus failures remain distinct from queue pressure, route divergence, speed saturation, and downstream fault lines.

## Audio

The script generates two low-volume PCM sine channels at 440 Hz and 880 Hz, 48 kHz, 16-bit stereo. This exercises host capture, Opus transport, client PCM pooling, AudioTrack, and the projector output without committing an audio artifact. It detects audio-path and controller-convergence faults but not acoustic lip sync. The release baseline must equal `150 + ((10 + 5) / 60 × 1000) + 15 = 415 ms`. Video reports relative source-timestamp-to-target-VSync depth. Audio reports relative ready-queue plus sink lead after 64 valid route samples. Their difference drives pitch-preserving playback between 0.98 and 1.02; at 220 of 256 queued packets, anti-windup forces +2% drain. Speaker synchronization still requires a zero-source-offset flash/click clip rendered natively on the captured monitor; ADB screencapture cannot observe acoustic output.

## Screenshot normalization

Bonfire OS emits a text preamble before some `exec-out screencap` PNGs. Always locate the PNG signature `89 50 4e 47 0d 0a 1a 0a` and discard preceding bytes. The jmgo CLI and test script do this. Never commit the resulting projector screenshot.

## Latency clock limitations

`assets/latency-clock.html` encodes host wall-clock ticks in large binary blocks. It can support qualitative before/after comparisons with an external camera. Repeated ADB screencaps take over a second on this projector and perturb the same Wi-Fi/ADB path, so their decoded age is not an authoritative end-to-end latency measurement.
