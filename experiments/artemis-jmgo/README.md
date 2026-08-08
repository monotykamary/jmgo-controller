# JMGO Artemis 60 FPS client experiment

This experiment patches Artemis `v20.2.6` (`4de0227fb6ae5c9ad9f7cc486aed7c3571f5f62f`) for the JMGO S901's proprietary `OMX.MS.AVC.Decoder`. It preserves 720p60 or 1080p60 H.264 quality and audio while decoupling the periodic host-delivery and decoder-output bursts that produced visible 90–114 ms freezes.

The debug build installs alongside Artemis as `com.limelight.noirdebug` with the label **JMGO Artemis Lab**.

## What changed

The solution decouples each blocking boundary with deliberate bounded reserves:

- moonlight-common-c can retain up to 60 complete encoded frames and paces them from host presentation timestamps with 150 ms of lead.
- MediaCodec input follows that smoothed clock instead of bursty network enqueue timestamps.
- `OMX.MS.AVC.Decoder` outputs into a 17-slot `YUV_420_888` ImageReader. Its decoded FIFO uses up to 15 slots; the other two cover one image in preparation and listener acquisition headroom.
- Preparation starts after ten decoded images and fills five copy-ready ImageWriter images.
- An urgent-display pacer anchors once to VSync and then increments a monotonic deadline every 16.67 ms. It queues 15 ms before VSync and requires at least 5 ms of compositor latch margin.
- Each writer image inherits the decoder's crop rectangle. SurfaceFlinger scales 1280×720 content across the 1920×1080 video layer and presents 1920×1080 content directly, avoiding an uninitialized border in either mode.
- Plane copies use three direct-buffer JNI calls per frame; native stride-aware `memcpy` is required because Java row copies only reached 45–49 FPS.
- AudioTrack uses a 10 ms device buffer. A preallocated 32-frame PCM pool moves blocking writes to an audio-priority worker, preserving samples without blocking Moonlight's receive callback.

The final profile intentionally prioritizes continuous motion over latency. Earlier zero-lead and one/four-image variants passed short gates but did not survive sustained high-detail motion on the actual captured virtual display. The certified path retains low audio latency while using 150 ms of input lead and the ten-image decoded startup depth.

## Build

Requirements:

- JDK 21
- Android platform 36
- Android build-tools 37
- NDK `27.0.12077973`
- `git`, `adb`, and network access for the Artemis clone and Gradle dependencies

On Homebrew macOS, `build` auto-detects `openjdk@21` and `android-commandlinetools`. It refuses to overwrite an existing work directory.

```bash
bash experiments/artemis-jmgo/build
# or choose a fresh location
bash experiments/artemis-jmgo/build /tmp/my-artemis-jmgo-build
```

The script prints the APK path and SHA-256. Install it with:

```bash
adb -s PROJECTOR_IP:5555 install -r \
  /tmp/artemis-jmgo-v20.2.6/app/build/outputs/apk/nonRoot_game/debug/app-nonRoot_game-debug.apk
```

Pair the new client with Sunshine, then select:

- Resolution: 1280×720 or 1920×1080 (both hardware-certified)
- Frame rate: 60 FPS
- Frame pacing: Balanced
- Codec: H.264

The YUV image pipeline is activated only for `OMX.MS.AVC.Decoder`, H.264, Android 10+, and Balanced pacing. Other combinations retain Artemis's normal rendering path.

For the tested host, Sunshine also uses:

```ini
minimum_fps_target = 30
```

The pinned [Sunshine JMGO patch](../sunshine-jmgo/README.md) retains AVFoundation capture frames under brief encoder backpressure and raises the capture callback QoS. `jmgo artemis` also force-stops `com.jmgo.setting.x` before launch because its background Wi-Fi scan caused a measured 450 ms transport outage.

## Hardware certification

### 720p60

A 60-second controlled-motion run on 2026-08-08 used Sunshine's `h264_videotoolbox` encoder at 7,308,000 bit/s with a continuous 48 kHz audio tone.

- 3,621 presented frames
- measured average: 62.116 FPS (SurfaceFlinger timing-window accounting)
- 100% of present-to-present intervals: 15–18 ms
- longest nonzero interval: 17 ms
- gaps of 34 ms or longer: 0
- SurfaceFlinger dropped, late-acquire, and bad-desired-present frames: 0
- network drops and decoder-input stalls: 0
- encoded queue overflows and underruns: 0
- decoded image-ring empties and timer delays: 0
- audio queue drops, AudioTrack failures, and legacy pending-audio backlogs: 0

A fresh 30-second run after removing diagnostic probes reproduced 100% 15–18 ms intervals with a 17 ms maximum and zero faults. After adding crop propagation for full-screen output, a final clean-clone 15-second hardware run presented 915/915 frames at 15–18 ms, with a 17 ms maximum and zero compositor, pipeline, or audio faults.

### 1080p60

A nonintrusive 60-second controlled-motion run used the same H.264 pipeline at 14,988,000 bit/s with continuous 48 kHz stereo PCM audio.

- 3,611 presented frames
- 100% of present-to-present intervals: 15–18 ms
- longest nonzero interval: 17 ms
- gaps of 34 ms or longer: 0
- SurfaceFlinger dropped, late-acquire, and bad-desired-present frames: 0
- network drops and decoder-input stalls: 0
- encoded queue overflows and underruns: 0
- decoded image-ring empties and timer delays: 0
- audio queue drops, AudioTrack failures, and legacy pending-audio backlogs: 0

A second nonintrusive 60-second run evaluated a zero-lead low-latency profile: presentation on the first decoded image and a 10 ms AudioTrack. It presented 3,617/3,617 intervals at 15–18 ms, but that acceptance gate did not yet count decoded-image queue replacement and therefore could not detect uneven content selection.

### Continuous-smoothness correction

With Sunshine `minimum_fps_target = 60`, the host emitted closely spaced supplemental frames during active 60 FPS capture. At 1080p the one-image client consumed exactly 60 images per second while its ten-image ring remained full and silently replaced 278 older decoded images in a 30-second run. SurfaceFlinger still showed a buffer every VSync, masking content jumps.

Controlled variants established the final boundary:

- Directly attaching ImageReader images to ImageWriter starved the proprietary decoder of reusable output buffers.
- Driving three-plane copies from Choreographer could not complete at 1080p60 and overflowed continuously.
- Timestamp-threshold coalescing starved the ring; PTS resampling failed because the decoder emits supplemental images only 1–7 ms apart.
- Lowering Sunshine's effective floor to 30 removed supplemental overflow. A one-image start then exposed three genuine decoder droughts in 45 seconds.
- Starting with four decoded images absorbed those droughts without returning to the old encoded-input lead.

The first corrected 60-second 1080p60 run used high-detail motion, 48 kHz stereo audio, `minimum_fps_target = 30`, zero encoded-input lead, four decoded startup images, and a 10 ms AudioTrack:

- 3,615/3,615 present-to-present intervals were 15–18 ms
- maximum interval: 17 ms
- decoded-image queue replacements: 0
- decoded ring empties and timer delays: 0
- network drops and late native input frames: 0
- compositor and audio faults: 0

A temporary compositor recording of the same linear-motion asset reduced stationary content steps from 16 to 1 and large position jumps from 19 to 1 versus the prior 60-floor/one-image profile. Recordings were deleted after analysis and are not project artifacts.

Extended testing exposed additional independent boundaries. A 13-image decoded FIFO replaced one image in five minutes, so the FIFO grew to 15. ImageReader grew from 16 to 17 to leave ownership headroom; 19 exceeded the proprietary decoder's buffer ceiling. Another run lost 31 network frames in 450 ms exactly while `com.jmgo.setting.x` performed a Wi-Fi scan. Correctly isolating the motion page on Sunshine's virtual display then exposed rare copy-ready droughts and 32–33 ms repeats caused by per-frame re-anchoring to asynchronous Choreographer updates. The final client starts after ten decoded images, holds five prepared images, and advances a fixed deadline without per-frame re-anchoring.

The definitive fresh-clone APK (`f7c97525112eb4aca6c2c4ac53391e5a0a6916a157cb81a5dd797156ea38875a`) passed an isolated five-minute run on virtual display 4: all 18,019 intervals were 15–18 ms, maximum 17 ms, with zero transport, decoded-queue, prepared-queue, timer, compositor, or audio faults.

## Patch layout

- `artemis-v20.2.6.patch` changes the Android client, JNI bridge, audio path, and debug app label.
- `moonlight-common-c.patch` changes the complete-frame queue and native input presentation clock inside Artemis's submodule.
- `build` clones the pinned release, applies both patches, builds, and prints the artifact hash.

This is hardware-specific experimental code, not a claim that the same latency tradeoff is appropriate for ordinary Moonlight clients.
