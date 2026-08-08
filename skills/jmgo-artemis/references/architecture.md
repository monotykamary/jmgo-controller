# Certified Artemis architecture

## Root cause

The visible hitch was downstream of transport. Repeated tests had zero network drops and zero MediaCodec input stalls while SurfaceFlinger showed periodic 90–114 ms present-to-present gaps. Lower bitrate and FEC changed quality but not the fixed pause. Sunshine's full-rate duplicate-frame setting, codec flags, refresh-mode changes, audio removal, and alternative frame-pacing modes did not remove it.

JMGO's `OMX.MS.AVC.Decoder` batches or stalls direct Surface output. Timestamp tuning alone cannot force a Surface buffer to appear. The durable boundary is decoded YUV ownership outside the proprietary decoder. Later continuous-motion testing also isolated an occasional macOS capture omission and a separate projector Wi-Fi scan outage; the final path covers all three boundaries.

## Final path

1. moonlight-common-c keeps a 60-frame-capable complete-frame queue and paces it from host presentation timestamps with 150 ms of deliberate lead.
2. Those timestamps replace bursty network enqueue timing before MediaCodec input.
3. H.264 from `OMX.MS.AVC.Decoder` targets a 17-slot `YUV_420_888` ImageReader and a 15-image decoded FIFO. The two non-FIFO slots cover one preparation-thread image and the listener's terminal acquisition probe.
4. The output callback releases immediately into ImageReader.
5. Preparation starts after ten decoded images and fills five copy-ready ImageWriter images.
6. An urgent-display pacer anchors once to Choreographer, then advances a strictly monotonic 16.67 ms deadline. It queues each image 15 ms before VSync and rejects any handoff leaving less than 5 ms of latch margin.
7. Three stride-aware JNI `memcpy` calls copy Y, U, and V. Java row copies reached only 45–49 FPS at 720p and were rejected.
8. The destination inherits the source crop. This fixes the 1280×720 image appearing in the upper-left of a 1920×1080 writer buffer with a green/uninitialized remainder.
9. Audio uses a 10 ms AudioTrack. A preallocated 32-packet PCM pool and audio-priority writer isolate Moonlight's callback from roughly 100 ms JMGO HAL write stalls without dropping samples.

The final profile prioritizes uninterrupted motion over latency: the native input clock contributes 150 ms and the decoded path waits for ten images before output starts. Five of those images are copy-ready, so the same startup depth can bridge the measured preparation drought without exhausting the eight-slot ImageWriter. The 15-image FIFO remains bounded burst capacity.

On the host, the pinned Sunshine patch retains AVFoundation frames during brief VideoToolbox backpressure and runs the capture callback at user-interactive QoS. Before client launch, the CLI force-stops `com.jmgo.setting.x`; reopening projector Settings during a stream can restart its disruptive Wi-Fi scanner.

## Direct application launch

`jmgo artemis apps` reads Sunshine's local `apps.json` and returns only contiguous one-based indexes and application names. Commands, environment variables, prep scripts, and image paths never leave the parser.

`--app` resolves one of those entries before touching the projector, restarts Sunshine by default, and invokes the exported Artemis `ShortcutTrampoline` with the exact `AppView.NAME_EXTRA` (`Name`) and `Game.EXTRA_APP_NAME` (`AppName`) keys. The trampoline resolves the paired computer and cached GameStream app ID, then starts `Game` directly. Every external value is POSIX-shell quoted before crossing `adb shell`, and control characters are rejected.

This removes host-grid and app-grid taps. It does not change Sunshine's capture boundary: the chosen entry is launched, while video still comes from the selected monitor. Artemis may need one ordinary host opening after a newly added Sunshine entry so its app-list cache includes that name.

## Activation scope

The image path activates only for:

- `OMX.MS.AVC.Decoder`
- H.264
- Android 10 or newer
- Balanced frame pacing

Every fallback retains upstream Artemis behavior.

## Latency sweep

Early latency sweeps reduced the encoded lead to zero, the output start to one image, and AudioTrack capacity from 120 ms to 10 ms. Those variants passed short compositor gates but did not survive sustained, correctly placed high-detail motion: content replacement, ImageReader ownership saturation, preparation droughts, and isolated 32–33 ms repeats remained. The final profile restores 150 ms of encoded lead while retaining the 10 ms audio path.

Sunshine's 60 FPS floor also generated supplemental closely timed images: the old ring replaced 278 images in 30 seconds even while compositor cadence looked perfect. Setting the floor to 30 removed that overproduction. A 17-slot ImageReader is the hardware-safe ownership limit; 19 slots caused `OMX.MS.AVC.Decoder` buffer registration failure. Five prepared images are the largest tested copy-ready reserve that leaves safe ImageWriter ownership headroom.

Do not lower the ten-image decoded threshold, the five-image prepared start, or the 150 ms input lead merely to chase latency. Do not restore `minimum_fps_target = 60`.

## Source locations

- Android client patch: `experiments/artemis-jmgo/artemis-v20.2.6.patch`
- Native queue/input clock patch: `experiments/artemis-jmgo/moonlight-common-c.patch`
- Reproducible client builder: `experiments/artemis-jmgo/build`
- macOS host patch and builder: `experiments/sunshine-jmgo/`
- Upstream Artemis: `v20.2.6`, commit `4de0227fb6ae5c9ad9f7cc486aed7c3571f5f62f`
- moonlight-common-c: `ad329b240f18826f320ce6a99226b36354b86b59`
