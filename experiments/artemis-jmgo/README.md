# JMGO Artemis 60 FPS client experiment

This experiment patches Artemis `v20.2.6` (`4de0227fb6ae5c9ad9f7cc486aed7c3571f5f62f`) for the JMGO S901's proprietary `OMX.MS.AVC.Decoder`. It preserves 720p60 H.264 quality and audio while absorbing the periodic host-delivery and decoder-output bursts that produced visible 90–114 ms freezes.

The debug build installs alongside Artemis as `com.limelight.noirdebug` with the label **JMGO Artemis Lab**.

## What changed

The solution uses buffering at each blocking boundary rather than changing H.264 quality:

- moonlight-common-c retains up to 60 complete encoded frames and paces them from host presentation timestamps with 150 ms lead.
- MediaCodec is fed 70 ms ahead and its bursty network enqueue timestamps are replaced with the smoothed presentation clock.
- `OMX.MS.AVC.Decoder` outputs into a 12-slot `YUV_420_888` ImageReader.
- A monotonic urgent-display thread starts with four decoded frames and presents one every 16.67 ms through ImageWriter.
- Plane copies use three direct-buffer JNI calls per frame; native stride-aware `memcpy` is required because Java row copies only reached 45–49 FPS.
- AudioTrack receives a 120 ms device buffer. A preallocated 32-frame PCM pool moves blocking writes to an audio-priority worker, preserving samples without blocking Moonlight's receive callback.

This adds roughly 150 ms of video latency. That is intentional: the measured stalls cannot be hidden by Moonlight's one-frame effective reserve.

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

- Resolution: 1280×720
- Frame rate: 60 FPS
- Frame pacing: Balanced
- Codec: H.264

The YUV image pipeline is activated only for `OMX.MS.AVC.Decoder`, H.264, Android 10+, and Balanced pacing. Other combinations retain Artemis's normal rendering path.

For the tested host, Sunshine also uses:

```ini
minimum_fps_target = 60
```

## Hardware certification

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

A fresh 30-second run after removing diagnostic probes reproduced 100% 15–18 ms intervals with a 17 ms maximum and zero faults.

## Patch layout

- `artemis-v20.2.6.patch` changes the Android client, JNI bridge, audio path, and debug app label.
- `moonlight-common-c.patch` changes the complete-frame queue and native input presentation clock inside Artemis's submodule.
- `build` clones the pinned release, applies both patches, builds, and prints the artifact hash.

This is hardware-specific experimental code, not a claim that the same latency tradeoff is appropriate for ordinary Moonlight clients.
