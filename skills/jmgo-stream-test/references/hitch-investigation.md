# Hitch investigation and eliminated hypotheses

This is the due-diligence record for the JMGO S901 periodic streaming hitch. Values are sanitized; no LAN address, host name, Android identifier, screenshot, credential, or proprietary APK belongs here.

## Symptom and measurement

The original stream visibly froze about once per second. SurfaceFlinger present-to-present histograms showed clusters around 90–114 ms while reporting zero compositor drops. This means SurfaceFlinger repeated the last frame because no new buffer arrived; it did not drop a buffer it had received.

The early 720p60 baseline reached roughly 55–57 presented FPS with recurring long gaps. The exact CSS bar in `assets/simple-motion.html` made the cadence defect obvious and repeatable. Historical copies named `artemis-balanced-motion.html`, `jmgo-test-motion.html`, `jmgo-audio-test-motion.html`, and `jmgo-buffer-test.html` were byte-identical (SHA-256 `66f4c85c381dd368d7c2cffbb972fda29df5fccbd6c26f6eaa3531afca5ee377`) and are intentionally consolidated into that one asset.

## Transport and encoder were not the original root cause

Tests varied Sunshine bitrate, FEC, minimum frame target, and content load.

- Lowering H.264 from about 7.3 Mbit/s to 4 Mbit/s reduced quality and did not reduce the fixed-duration gaps.
- Network frame-drop counters remained zero during representative hitches.
- MediaCodec input-buffer stall counters remained zero.
- `minimum_fps_target = 60` ensured static content still produced frames but did not fix the pause; later content-cadence telemetry showed it was too aggressive for the final client.
- The host encoder continued producing H.264 with normal cadence. A custom encoder would not fix a downstream decoder-to-Surface scheduling pause.

Conclusion for the repeating 90–114 ms baseline: preserve VideoToolbox quality and fix the client boundary. Later long-duration testing found two independent residual events at the host capture and projector Wi-Fi boundaries.

## Headless reconstruction

`experiments/decoder-pacing/jmgo-h264-720p60.json` records a sanitized measured stall model. The deterministic simulator separates transport load from a fixed decoder-scheduler pause. It proved that adding transport load cannot erase a post-transport stall, while deeper buffering monotonically trades latency for fewer repeated frames. This guided live tests but never replaced hardware SurfaceFlinger evidence.

## Frame pacing and display clock

The projector exposes 1920×1080 at approximately 60 Hz. Alternative client pacing modes, refresh-mode selection, immediate timestamped Surface releases, Choreographer priority changes, larger codec output queues, and timestamp-only experiments did not eliminate the periodic stall. Some produced mixed 5–25 ms intervals or retained 90–114 ms gaps.

Balanced pacing remained the right user-facing mode, but its producer had to move away from the proprietary decoder's direct Surface path.

## Audio isolation

A separate package disabled audio at the protocol level. Video still hitched, proving audio was not the root cause. The test did expose a second issue: JMGO AudioTrack writes can block for about 100 ms, and naive nonblocking writes dropped PCM samples.

The final audio design preserves every packet in a preallocated 32-frame pool and performs blocking writes on an audio-priority worker. The cadence-certified build later requested 300 ms to mirror video buffering, but the projector speaker HAL added enough output latency to put audio roughly 100 ms behind video. A 10 ms request was not viable on this HAL: Android expanded it from 480 to 4,330 frames and the active track accumulated 144 underruns. Forty 5 ms packets request 9,600 frames; the active track measured 315.72 ms total latency with zero underruns, matching the roughly 316.7 ms video clock.

## Decoder scheduling and image ownership

Logs and source tracing isolated the gap after transport/input and before Surface presentation. `OMX.MS.AVC.Decoder` batches or withholds direct Surface buffers. The successful design decodes to `YUV_420_888` ImageReader, owns decoded images in an application queue, and writes them to the visible Surface on a monotonic timer.

A Java plane-copy implementation was rejected because it sustained only 45–49 FPS at 720p. Three native stride-aware `memcpy` calls per frame reached 60 FPS at both 720p and 1080p.

## Crop regression

ImageWriter allocates at the physical 1920×1080 Surface size. Copying a 1280×720 source without setting destination crop displayed the stream in the upper-left and left more than half of the output green/uninitialized. Propagating `source.getCropRect()` removed the region completely and lets SurfaceFlinger scale 720p; 1080p presents directly.

## Hidden content-cadence regression

The one-image/60-floor profile eliminated freezes but did not feel continuously smooth. The old gate saw a new Surface buffer every VSync and therefore missed which decoded content frame was chosen. Adding overflow telemetry revealed 278 silent oldest-image replacements in 30 seconds at 1080p. Every observed overflow coincided with proprietary decoder outputs only 1–7 ms apart.

Rejected follow-ups were important:

- Zero-copy ImageReader-to-ImageWriter attachment starved decoder output-buffer reuse.
- Choreographer-driven YUV copies could not sustain 1080p60.
- Sub-frame timestamp coalescing removed too many valid images and caused ring starvation.
- PTS resampling failed because the decoder's supplemental image timestamps do not form a clean 60 Hz source clock.

Sunshine's 60 FPS minimum was generating supplemental work on top of active 60 FPS capture. Reducing it to 30 eliminated decoded queue replacement. A one-image start then exposed three real ring droughts in 45 seconds. Continued correctly placed virtual-display testing ultimately required a ten-image decoded startup threshold, with five images copied and ready before the fixed-period pacer begins.

## Residual host and network boundaries

With client content replacement visible, a five-minute run found one decoded FIFO replacement despite otherwise perfect compositor cadence. The macOS capture output still discarded late frames under brief encoder backpressure. The pinned Sunshine build retains those frames and raises its serial callback from user-initiated to user-interactive QoS. The decoded FIFO remains 15 images, while ImageReader capacity is 17 so one preparation-thread image and the listener's terminal acquisition probe do not hit `maxImages`. A 19-slot attempt exceeded the proprietary decoder's GraphicBuffer ceiling and was rejected.

A later run lost 31 network frames in 450 ms and logged 27 prepared-queue empties. Timestamp correlation showed `com.jmgo.setting.x` running `WifiTracker` scans at that exact instant despite a -36 dBm, 780 Mbit/s 5 GHz link. Force-stopping that process before launch eliminated the scan; global Wi-Fi and scan-always settings did not need to be changed. Reopening projector Settings can restart it.

## Latency refinement

The first stable image-ring build deliberately used about 130 ms of video reserve plus 120 ms AudioTrack capacity. Short latency sweeps reached zero input lead and a 10 ms audio request, but sustained correctly placed motion still exposed rare ownership, preparation, and presentation failures. The final smoothness-first path restores 150 ms of encoded-input lead, waits for ten decoded images, starts with five copy-ready images, and uses a 200 ms AudioTrack request to align with the speaker HAL. The 15-image FIFO is bounded burst capacity.

## Final evidence

The definitive pre-sync fresh-clone five-minute 1080p60 run at about 14.988 Mbit/s used patched Sunshine capture, `minimum_fps_target = 30`, 150 ms input lead, a ten-image decoded threshold, five copy-ready images, a 15-image burst limit, fixed-period deadlines, scan suppression, high-detail motion isolated in a dedicated Safari window on virtual display 4, and stereo audio. All 18,019 intervals were 15–18 ms with a 17 ms maximum and zero queue replacement, prepared-queue empty, timer delay, Wi-Fi scan, network drop, late native input, compositor fault, or audio fault. The pre-sync APK SHA-256 is `f7c97525112eb4aca6c2c4ac53391e5a0a6916a157cb81a5dd797156ea38875a`; it used the later-rejected 300 ms AudioTrack request.

The speaker-synchronized fresh-clone APK SHA-256 is `7fd9eff6c4815ca1a90fb6dac9f0d72cc89a9b1adc91225b94dc7438f6ad16ac`. Its 9,600-frame track measured 315.72 ms active latency with zero underruns, within about 1 ms of the calculated 316.67 ms video reserve. See `measurements.json`.

## Source-display and instrumentation traps

When Sunshine captures a virtual display, opening the motion page on the main monitor does not exercise streamed content and invalidates content-cadence conclusions. The test now creates a dedicated Safari window by ID on Sunshine's configured display and closes only that window. Do not change its tab during timing.

Do not run `adb top`, screencap, log polling, or any midpoint ADB command during a cadence window. One deliberate midpoint `adb top` probe monopolized the projector path, dropped network frames, emptied the image ring for roughly 2.5 seconds, and created 1000 ms histogram bins. A clean repeat with only `sleep 60` passed perfectly. Instrumentation-induced stalls are not product evidence.
