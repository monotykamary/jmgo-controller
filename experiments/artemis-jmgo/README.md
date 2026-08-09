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
- AudioTrack requests 200 ms (forty 5 ms packets) solely to absorb JMGO HAL stalls. A preallocated 256-packet PCM pool moves blocking writes to an audio-priority worker without blocking Moonlight's receive callback. PCM retains the derived 415 ms release baseline. A shared clock compares measured video-depth change with combined queued-PCM and AudioTrack sink-lead change, then slews pitch-preserving playback speed within ±2%.

The final profile intentionally prioritizes continuous motion over latency. Earlier zero-lead and one/four-image variants passed short gates but did not survive sustained high-detail motion on the actual captured virtual display. The prepared path targets synchronized projector-speaker audio while using 150 ms of input lead and two explicit image-staging depths.

### Speaker A/V synchronization

AudioTrack capacity is an underrun boundary, not an A/V clock. A 10 ms request was rejected because the HAL expanded it from 480 to 4,330 sample frames and the active track accumulated 144 underruns. Changing capacity from 300 ms to 200 ms retained zero underruns but still let audio precede a timestamp-matched flash on the streamed display.

The route baseline remains `150 ms + ((10 decoded + 5 prepared) / 60 FPS) + 15 ms = 415 ms`. Each prepared image carries the MediaCodec source timestamp created by the native monotonic input pacer. At successful ImageWriter handoff, the client publishes that timestamp with the nominal target VSync and measures `150 ms input lead + target VSync - source timestamp`. An eighth-step filter follows runtime video depth; values outside the configured five-to-thirty-image safety envelope are rejected, and a clock older than one second contributes no relative depth change.

Audio release deadlines stay monotonic around 415 ms, minus at most 20 ms of filtered writer-wake compensation. After AudioTrack has accepted forty packets, `AudioTrack.getTimestamp()` is sampled every sixteen packets. The first 64 valid samples warm a combined audio-route baseline consisting of ready-queue duration plus sink lead. Later route changes are filtered in sixteenth-steps over a ±2 second range. The controller computes `video depth change - audio route change` and slews `PlaybackParams` between 0.98 and 1.02 in 0.0005 steps while fixing pitch at 1.0. This changes audio phase continuously without moving fixed VSync deadlines or issuing non-monotonic PCM release times.

A 220-of-256 packet pressure threshold is the anti-windup boundary. Crossing it forces the target speed to 1.02; the remaining 36 packets cover the worst speed-slew transition before the queue begins draining. The long-horizon simulation reproduces the rejected 150 ms route-clamp overflow, requires the measured 404 ms video-depth ramp to settle below 164 packets, and checks a ten-minute untrackable phase step without overflow. The controller remains anchored to decoded-audio callback arrival because the Java audio interface does not expose RTP media PTS.

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

The cadence-certified pre-sync APK (`f7c97525112eb4aca6c2c4ac53391e5a0a6916a157cb81a5dd797156ea38875a`) passed an isolated five-minute run on virtual display 4: all 18,019 intervals were 15–18 ms, maximum 17 ms, with zero transport, decoded-queue, prepared-queue, timer, compositor, or audio faults. Its 300 ms AudioTrack predates the projector-speaker synchronization correction.

The capacity-only APK (`7fd9eff6c4815ca1a90fb6dac9f0d72cc89a9b1adc91225b94dc7438f6ad16ac`) requests 38,400 bytes and retained all 9,600 sample frames with zero underruns, but a zero-offset monitor-4 test proved that audio still preceded video. It is retained only as rejected evidence.

The pre-handoff-formula APK (`ccc41b60a56748d81bc190968bd29f76641521e3dc279f3e9296e5f141f0cd28`) added a 400 ms timestamp policy. A zero-source-offset flash/click check looked close, but subsequent YouTube playback exposed audio still slightly preceding video because the formula ended at ImageWriter handoff.

The fixed handoff-aware APK (`875228d3973f280d7ef969ef3698c1e0673f3ce187af07667417ad6ddba1d3f0`) added the pacer's 15 ms pre-VSync interval for 415 ms total. It retained zero underruns and no queue drops, but YouTube playback still moved between slightly audio-early and slightly audio-late because the runtime clocks were not coupled.

The offline dynamic-clock APK (`cb667b0f2bac1261f86b29302083b6f860c11fb99af97fe6b331f1e919b39048`) established the source-timestamp and AudioTimestamp feedback path. The later full-route APK (`ba7b7d4670c530024e0413e0ca7f0f6c12f0fdbf1fde0f8a35ba0c5f4242fae3`) presented all 18,011 five-minute intervals at 15–18 ms with a 17 ms maximum, but was rejected: its obsolete ±150 ms route clamp left playback pinned at 0.98 while video depth reached 404 ms, queued PCM reached 1,270 ms, and the pool logged at least 512 drops.

The installed anti-windup APK (`86b5ba451c06e5cf18111261be0a078499eca32859f182244b7fe4193caf04bf`) expands route feedback to ±2 seconds, uses 256 PCM packets, and forces a +2% drain at 220 packets. It was built for every ABI from a fresh pinned clone; exact Java blob hashes match the generator source, and the direct clock harness plus accelerated five- and ten-minute simulations pass. A 60-second live run presented 3,691/3,691 intervals at 15–18 ms with a 17 ms maximum and zero faults. The convergence-aware 20-second gate then presented 1,222/1,222 intervals, found at most 795 ms queued audio, 10 ms tail phase error, no speed saturation or pressure drain, and zero faults while restoring Dia after Safari setup. First-principles source instrumentation later measured a controlled ten-second run at 60.006 source rAF FPS with no timed source gap, focus loss, hidden event, compositor fault, or pipeline fault. A Dia-foreground twenty-second run independently measured exactly 60 source FPS, 1,236/1,236 normal compositor intervals, at most 525 ms queued audio, 6 ms tail phase error, and zero faults. The page draws a 16-bit frame marker, but downstream pixel decoding remains pending. The final idle five-minute soak remains pending because an interactive host is not a controlled certification environment.

## Patch layout

- `artemis-v20.2.6.patch` changes the Android client, JNI bridge, audio path, and debug app label.
- `moonlight-common-c.patch` changes the complete-frame queue and native input presentation clock inside Artemis's submodule.
- `build` clones the pinned release, applies both patches, builds, and prints the artifact hash.

This is hardware-specific experimental code, not a claim that the same latency tradeoff is appropriate for ordinary Moonlight clients.
