# Sunshine JMGO host experiment

This experiment pins Sunshine `v2026.726.710` at commit
`7cb92071ac4394698e92ff6d070d310db9acc32c` and changes the macOS capture
and host media-clock boundaries:

- discard stale AVFoundation frames when the encoder falls behind, keeping the
  newest desktop image instead of growing capture latency;
- run the serial capture callback at user-interactive QoS;
- timestamp captured video and audio in one steady-clock domain and derive both
  RTP timelines from the same per-session epoch.

The patch is paired with the Artemis queue, shared A/V controller, and projector
scan suppression in this repository. None of those changes is independently
sufficient for the final 1080p60 result.

## Why

Retaining every AVFoundation frame preserved source history but allowed stale
capture work to accumulate during high-detail motion. The measured video media
lead then exceeded one second and the synchronized audio queue grew to 755 ms.
Keeping the newest frame bounds that host-side latency while Sunshine rate
control and the projector client continue presenting at native cadence. A shared
host timestamp domain lets the client delay audio to the actual video phase
instead of guessing from independently started RTP clocks.

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

Then enable **Sunshine JMGO Media Clock** under **Privacy & Security → Screen &
System Audio Recording**. Also allow incoming connections if macOS asks. The authenticated
configuration UI is `https://localhost:47990`. The installer
registers the app with the application firewall when permitted.

The custom app uses bundle identifier `dev.lizardbyte.app.Sunshine.jmgo.media`
so the official Sunshine permission remains independent. By default it is ad-hoc
signed; set `JMGO_CODESIGN_IDENTITY` to a stable signing identity before running
the installer when updates must retain the same macOS privacy identity. The
installer refuses to overwrite an existing authorized build.

`jmgo artemis` automatically prefers `/Applications/Sunshine JMGO Media
Clock.app`, then the legacy `/Applications/Sunshine JMGO.app`. Set
`JMGO_SUNSHINE_APP` to another app path or registered application name when
needed.

## Certified profile

```bash
jmgo artemis --monitor 4 --minimum-fps 30 --app Desktop
jmgo-stream-test --duration 300
```

The clean 60-second hardware gate for the newest-frame/shared-clock build passed
every layer together. The projector presented all 3,692 intervals at 15–17 ms
with a 17 ms maximum. The source ran at 60.001 FPS with no timed scheduling gap,
focus loss, or hidden event; its downstream marker recorded 3,536 unique frames,
70 repeats, 65 skips, and a discontinuity imbalance of 5. Video holdback stayed
between 282 and 285 ms, image writing took at most 6.121 ms, and handoff retained
8.140 ms of margin. Queued audio peaked at 405 ms, maximum measured A/V media
lead was 698 ms, tail phase error was 4 ms, and no transport, decoder, queue,
compositor, audio, or watchdog fault occurred. The stream negotiated H.264 at
1920×1080, 60 FPS, and 14,988,000 bit/s.

Do not run the official and JMGO Sunshine apps simultaneously. Do not perform
ADB probes during the timed certification interval.
