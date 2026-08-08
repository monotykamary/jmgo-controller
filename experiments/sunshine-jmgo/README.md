# Sunshine JMGO host experiment

This experiment pins Sunshine `v2026.726.710` at commit
`7cb92071ac4394698e92ff6d070d310db9acc32c` and changes only the macOS
AVFoundation capture boundary:

- retain late capture frames instead of dropping them under brief encoder backpressure;
- run the serial capture callback at user-interactive QoS.

The patch is paired with the Artemis queue and projector scan suppression in
this repository. None of the three changes is independently sufficient for the
final 1080p60 result.

## Why

The stock capture output could omit an occasional 60 Hz source frame even when
VideoToolbox, the network, MediaCodec, and SurfaceFlinger were otherwise
healthy. Retaining capture frames removed that source-side discontinuity.

A separate 450 ms failure was traced exactly to `com.jmgo.setting.x` issuing a
Wi-Fi scan. The CLI and certification script force-stop that settings process
before streaming. The app returns normally when projector Settings is opened.

## Build

Prerequisites on macOS:

```bash
brew install boost cmake miniupnpc ninja node pkg-config
```

Build from the immutable upstream tag:

```bash
experiments/sunshine-jmgo/build
```

The default output is:

```text
/tmp/sunshine-jmgo-v2026.726.710/cmake-build-jmgo/Sunshine.app
```

The builder verifies the Vite Web UI and copies it into the app after all parallel targets finish. Upstream's independent macOS post-build copy can otherwise race the `web-ui` target and produce a blank configuration page.

Run the upstream test binary from the build tree:

```bash
/tmp/sunshine-jmgo-v2026.726.710/cmake-build-jmgo/tests/test_sunshine
```

A fresh ad-hoc bundle has no macOS capture/audio/input authorization. Upstream platform suites can therefore fail suite setup while reporting zero failed test cases; certify those boundaries with the authorized side-by-side app and `jmgo-stream-test`.

## Install

Install side by side with the signed release build:

```bash
experiments/sunshine-jmgo/install
open -n "/Applications/Sunshine JMGO.app"
```

Then enable **Sunshine JMGO** under **Privacy & Security → Screen & System
Audio Recording**. Also allow incoming connections if macOS asks. The authenticated
configuration UI is `https://localhost:47990`. The installer
registers the app with the application firewall when permitted.

The custom app uses bundle identifier `dev.lizardbyte.app.Sunshine.jmgo` so the
official Sunshine permission remains independent. It is ad-hoc signed. Replacing
or re-signing it changes its code hash and therefore requires Screen Recording
reauthorization. The installer refuses to overwrite an existing build for this
reason.

`jmgo artemis` automatically prefers `/Applications/Sunshine JMGO.app`. Set
`JMGO_SUNSHINE_APP` to another app path or registered application name when
needed.

## Certified profile

```bash
jmgo artemis --monitor 4 --minimum-fps 30 --app Desktop
jmgo-stream-test --duration 300
```

The final isolated virtual-display run presented all 18,019 measured intervals in
15–18 ms, with a 17 ms maximum and zero transport, decoder, decoded-queue,
prepared-queue, compositor, or audio faults. It used the pristine Artemis APK with
SHA-256 `f7c97525112eb4aca6c2c4ac53391e5a0a6916a157cb81a5dd797156ea38875a`. The stream negotiated H.264 at 1920×1080, 60 FPS,
and 14,988,000 bit/s.

Do not run the official and JMGO Sunshine apps simultaneously. Do not perform
ADB probes during the timed certification interval.
