# Hitch investigation and eliminated hypotheses

This is the due-diligence record for the JMGO S901 periodic streaming hitch. Values are sanitized; no LAN address, host name, Android identifier, screenshot, credential, or proprietary APK belongs here.

## Symptom and measurement

The original stream visibly froze about once per second. SurfaceFlinger present-to-present histograms showed clusters around 90–114 ms while reporting zero compositor drops. This means SurfaceFlinger repeated the last frame because no new buffer arrived; it did not drop a buffer it had received.

The early 720p60 baseline reached roughly 55–57 presented FPS with recurring long gaps. The exact CSS bar in `assets/simple-motion.html` made the cadence defect obvious and repeatable. Historical copies named `artemis-balanced-motion.html`, `jmgo-test-motion.html`, `jmgo-audio-test-motion.html`, and `jmgo-buffer-test.html` were byte-identical (SHA-256 `66f4c85c381dd368d7c2cffbb972fda29df5fccbd6c26f6eaa3531afca5ee377`) and are intentionally consolidated into that one asset.

## Transport and encoder were not the root cause

Tests varied Sunshine bitrate, FEC, minimum frame target, and content load.

- Lowering H.264 from about 7.3 Mbit/s to 4 Mbit/s reduced quality and did not reduce the fixed-duration gaps.
- Network frame-drop counters remained zero during representative hitches.
- MediaCodec input-buffer stall counters remained zero.
- `minimum_fps_target = 60` ensured static content still produced frames but did not fix the pause.
- The host encoder continued producing H.264 with normal cadence. A custom encoder would not fix a downstream decoder-to-Surface scheduling pause.

Conclusion: preserve VideoToolbox quality and fix the client boundary.

## Headless reconstruction

`experiments/decoder-pacing/jmgo-h264-720p60.json` records a sanitized measured stall model. The deterministic simulator separates transport load from a fixed decoder-scheduler pause. It proved that adding transport load cannot erase a post-transport stall, while deeper buffering monotonically trades latency for fewer repeated frames. This guided live tests but never replaced hardware SurfaceFlinger evidence.

## Frame pacing and display clock

The projector exposes 1920×1080 at approximately 60 Hz. Alternative client pacing modes, refresh-mode selection, immediate timestamped Surface releases, Choreographer priority changes, larger codec output queues, and timestamp-only experiments did not eliminate the periodic stall. Some produced mixed 5–25 ms intervals or retained 90–114 ms gaps.

Balanced pacing remained the right user-facing mode, but its producer had to move away from the proprietary decoder's direct Surface path.

## Audio isolation

A separate package disabled audio at the protocol level. Video still hitched, proving audio was not the root cause. The test did expose a second issue: JMGO AudioTrack writes can block for about 100 ms, and naive nonblocking writes dropped PCM samples.

The final audio design preserves every packet in a preallocated 32-frame pool and performs blocking writes on an audio-priority worker. Once that isolation existed, AudioTrack itself could return from the conservative 120 ms capacity to 10 ms without callback stalls or drops.

## Decoder scheduling and image ownership

Logs and source tracing isolated the gap after transport/input and before Surface presentation. `OMX.MS.AVC.Decoder` batches or withholds direct Surface buffers. The successful design decodes to `YUV_420_888` ImageReader, owns decoded images in an application queue, and writes them to the visible Surface on a monotonic timer.

A Java plane-copy implementation was rejected because it sustained only 45–49 FPS at 720p. Three native stride-aware `memcpy` calls per frame reached 60 FPS at both 720p and 1080p.

## Crop regression

ImageWriter allocates at the physical 1920×1080 Surface size. Copying a 1280×720 source without setting destination crop displayed the stream in the upper-left and left more than half of the output green/uninitialized. Propagating `source.getCropRect()` removed the region completely and lets SurfaceFlinger scale 720p; 1080p presents directly.

## Latency refinement

The first stable image-ring build deliberately used about 130 ms of video reserve plus 120 ms AudioTrack capacity. Controlled sweeps then removed the encoded-input lead and tested four, two, and one decoded startup images. Every variant passed 1080p60 motion/audio. The final path uses zero artificial lead, starts on one image, and uses a 10 ms AudioTrack while retaining burst capacities.

## Final evidence

Final nonintrusive runs at 1080p60 and about 14.988 Mbit/s produced 100% 15–18 ms intervals, a 17 ms maximum, no ≥34 ms gaps, and zero network, decoder, image-ring, compositor, or audio faults. See `measurements.json`.

## Instrumentation trap

Do not run `adb top`, screencap, log polling, or any midpoint ADB command during a cadence window. One deliberate midpoint `adb top` probe monopolized the projector path, dropped network frames, emptied the image ring for roughly 2.5 seconds, and created 1000 ms histogram bins. A clean repeat with only `sleep 60` passed perfectly. Instrumentation-induced stalls are not product evidence.
