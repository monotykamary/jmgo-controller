# Certified Artemis architecture

## Root cause

The visible hitch was downstream of transport. Repeated tests had zero network drops and zero MediaCodec input stalls while SurfaceFlinger showed periodic 90–114 ms present-to-present gaps. Lower bitrate and FEC changed quality but not the fixed pause. Sunshine's full-rate duplicate-frame setting, codec flags, refresh-mode changes, audio removal, and alternative frame-pacing modes did not remove it.

JMGO's `OMX.MS.AVC.Decoder` batches or stalls direct Surface output. Timestamp tuning alone cannot force a Surface buffer to appear. The durable boundary is decoded YUV ownership outside the proprietary decoder.

## Final path

1. moonlight-common-c keeps a 60-frame-capable complete-frame queue but adds zero artificial steady-state lead.
2. Host presentation timestamps pace MediaCodec input and replace bursty enqueue timestamps.
3. H.264 from `OMX.MS.AVC.Decoder` targets a 12-slot `YUV_420_888` ImageReader.
4. The output callback releases immediately into ImageReader.
5. An urgent-display monotonic timer starts on the first decoded image and presents every 16.67 ms through ImageWriter.
6. Three stride-aware JNI `memcpy` calls copy Y, U, and V. Java row copies reached only 45–49 FPS at 720p and were rejected.
7. The destination inherits the source crop. This fixes the 1280×720 image appearing in the upper-left of a 1920×1080 writer buffer with a green/uninitialized remainder.
8. Audio uses a 10 ms AudioTrack. A preallocated 32-packet PCM pool and audio-priority writer isolate Moonlight's callback from roughly 100 ms JMGO HAL write stalls without dropping samples.

The ImageReader and PCM queues are capacities, not prefilled latency. They can grow during a burst but add no deliberate steady-state reserve.

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

The first stable prototype used an effective 80 ms encoded-input lead, four decoded startup frames (about 50 ms after the first presentation), and a 120 ms AudioTrack. Once ImageReader isolation was proven, hardware sweeps tested four, two, and one decoded start frames with zero input lead. All passed 1080p60. The final profile starts on one image and uses 10 ms audio, removing about 130 ms of configured video reserve and 110 ms of AudioTrack capacity.

Do not reduce queue capacities merely to chase latency: unfilled capacity is not delay and protects transient stalls.

## Source locations

- Android client patch: `experiments/artemis-jmgo/artemis-v20.2.6.patch`
- Native queue/input clock patch: `experiments/artemis-jmgo/moonlight-common-c.patch`
- Reproducible builder: `experiments/artemis-jmgo/build`
- Upstream Artemis: `v20.2.6`, commit `4de0227fb6ae5c9ad9f7cc486aed7c3571f5f62f`
- moonlight-common-c: `ad329b240f18826f320ce6a99226b36354b86b59`
