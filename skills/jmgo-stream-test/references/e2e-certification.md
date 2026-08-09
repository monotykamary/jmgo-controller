# End-to-end certification protocol

## Acceptance ledger

A release is complete only when all checks pass:

1. The installed package is `com.limelight.noirdebug`; old stock/experiment packages are absent.
2. Artemis negotiates H.264 at the requested 1280×720 or 1920×1080 and 60 FPS.
3. Logs show 150 ms input lead, decoded and five-image prepared queue depths at timer start, a 38,400-byte stereo AudioTrack request, and `JMGO dynamic audio sync enabled with 415 ms audio baseline` followed by periodic holdback, scheduler compensation, sink lead, queued audio, route change, queue-drain, video-depth, and playback-speed telemetry. On the built-in speaker route, AudioFlinger should report 9,600 frames and zero underruns; its variable latency column is not the A/V synchronization clock.
4. Patched Sunshine JMGO reports the expected monitor, bitrate, and `minimum_fps_target = 30`; the application firewall permits its LAN traffic. The motion page must be in the dedicated Safari window on that same monitor.
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
5. Run `pnpm simulate:avsync`, then `jmgo-stream-test --host HOST --monitor 4 --duration 20` for fast convergence feedback and `--duration 60` for the ordinary hardware gate. Certify the final candidate with one idle `--duration 300` soak. The script creates, verifies, and later closes a dedicated Safari window on the selected display while restoring the previously frontmost application after setup.
6. Do nothing else during the definitive five-minute sleep. An interactive-machine pass is a separate stress test because foreground applications share WindowServer, GPU, capture, encoder, and network resources; it cannot be relabeled as controlled certification.
7. Treat any long gap or fault event as failure; inspect timestamps before rerunning.
8. Use `--screenshot /tmp/result.png` only after timing.

## Why SurfaceFlinger

The rendered layer's present-to-present histogram observes what actually reaches the projector compositor. Client FPS counters can report decode or receive activity while the visible Surface repeats an old buffer. It also cannot prove that each submitted buffer contains the right temporal frame, so decoded queue replacement is independently fatal. The target layer is:

```text
SurfaceView - com.limelight.noirdebug/com.limelight.Game#0
```

## Diagnostic patterns

The test rejects log lines containing:

- encoded queue overflow
- network frame/audio drop
- `WifiTracker` scan during the timed interval
- MediaCodec input dequeue stall
- ≥50 ms input pacing lateness
- decoded image queue replacement
- decoded image-ring empty
- timer scheduler delay
- ImageReader stall or ImageWriter rejection
- audio queue drop or AudioTrack write failure
- legacy pending-audio backlog
- queued audio at or above 1,100 ms or any pressure-drain sample
- more than 75 ms of tail route/video error
- playback pinned near 0.98 or 1.02 for all three tail samples
- fatal exception

## Audio

The script generates two low-volume PCM sine channels at 440 Hz and 880 Hz, 48 kHz, 16-bit stereo. This exercises host capture, Opus transport, client PCM pooling, AudioTrack, and the projector output without committing an audio artifact. It detects audio-path and controller-convergence faults but not acoustic lip sync. The release baseline must equal `150 + ((10 + 5) / 60 × 1000) + 15 = 415 ms`. Video reports relative source-timestamp-to-target-VSync depth. Audio reports relative ready-queue plus sink lead after 64 valid route samples. Their difference drives pitch-preserving playback between 0.98 and 1.02; at 220 of 256 queued packets, anti-windup forces +2% drain. Speaker synchronization still requires a zero-source-offset flash/click clip rendered natively on the captured monitor; ADB screencapture cannot observe acoustic output.

## Screenshot normalization

Bonfire OS emits a text preamble before some `exec-out screencap` PNGs. Always locate the PNG signature `89 50 4e 47 0d 0a 1a 0a` and discard preceding bytes. The jmgo CLI and test script do this. Never commit the resulting projector screenshot.

## Latency clock limitations

`assets/latency-clock.html` encodes host wall-clock ticks in large binary blocks. It can support qualitative before/after comparisons with an external camera. Repeated ADB screencaps take over a second on this projector and perturb the same Wi-Fi/ADB path, so their decoded age is not an authoritative end-to-end latency measurement.
