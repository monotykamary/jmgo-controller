# jmgo-controller

[![CI](https://github.com/monotykamary/jmgo-controller/actions/workflows/ci.yml/badge.svg)](https://github.com/monotykamary/jmgo-controller/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An unofficial, local-first TypeScript CLI and library for JMGO projectors running Bonfire OS. It combines the projector's native LAN protocol, Android Debug Bridge automation, and an optional verified Google Play delivery pipeline.

The protocol was validated on a JMGO S901 running Bonfire OS. Other models may use different key codes or transports. This project is not affiliated with JMGO or Google.

## Features

- Discover JMGO endpoints on the local network.
- Read projector state, including current volume and firmware information.
- Send navigation, volume, home, settings, and power events over TCP port 9005.
- List, install, uninstall, and launch Android applications through ADB.
- Capture valid screenshots even when Bonfire OS prefixes binary shell output.
- Open the certified JMGO Artemis Lab client, clear stale Sunshine sessions, and select the streamed macOS monitor and Sunshine application.
- Send keyboard, mouse, and touch input events to the projector over ADB (`jmgo adb input`).
- Download Play APK splits with `gplaydl`, verify every split has the same signing certificate, and install them in one ADB session.
- Redact serial numbers and Bluetooth addresses and strip unsafe Unicode formatting by default.
- Import the protocol, remote, ADB, discovery, and Play APIs from TypeScript or JavaScript.

## Security warning

Some Bonfire OS builds expose unauthenticated ADB over the local network. Anyone who can reach TCP port 5555 may be able to inspect or control the projector. Put the projector on a trusted network or isolated IoT VLAN.

`jmgo-controller` never asks for, reads, stores, or prints Google passwords, 2FA codes, Play tokens, or API keys. Optional Play authentication belongs entirely to `gplaydl` and lives outside this repository under its own configuration directory. Use a separate Google account: unofficial Play clients can cause account restrictions.

## Requirements

- Node.js 20 or newer
- pnpm 10 for development
- A JMGO projector reachable on the same LAN
- Android Platform Tools for ADB commands
- Keyboard, mouse, and touch input control is built in (via ADB)
- Artemis host integration: macOS with Sunshine
- Stream certification: Safari, `ffmpeg`, and `afplay`
- Optional Play support:
  - `gplaydl` 4.x
  - Android SDK Build Tools providing `apksigner`

On macOS:

```bash
brew install --cask android-platform-tools
pipx install gplaydl
```

Install Android SDK Build Tools through Android Studio or `sdkmanager`; ensure `apksigner` is on `PATH`.

## Installation

From a checkout:

```bash
pnpm install
pnpm build
pnpm link --global
```

Discover and remember the projector, then inspect dependencies:

```bash
jmgo discover
jmgo discover set
# For a larger or different subnet:
jmgo discover set --network 192.168.0.0/22
jmgo host show
jmgo doctor
```

The saved host is written atomically with user-only permissions to
`~/.config/jmgo-controller/config.json` (or the platform equivalent). Resolution priority is
`--host`, then `JMGO_HOST`, then the saved host. Manage it explicitly with:

```bash
jmgo host set 192.168.1.50
jmgo host clear
```

## Help and shell completions

Every command documents itself progressively: `jmgo --help` lists the command
groups, `jmgo remote --help` shows the remote subcommands, and
`jmgo remote key --help` lists every key with its Android key code. Mistyped
commands suggest the closest match.

Tab-completion covers subcommands, flags, remote keys, and static choices for
bash, zsh, and fish:

```bash
jmgo completions zsh              # print the script (eval/source it)
jmgo completions zsh --install    # wire it into your shell (auto-loaded directory, or an rc-file block)
jmgo completions zsh --uninstall  # remove it
```

## Native remote control

```bash
jmgo remote status
jmgo remote volume
jmgo remote volume down
jmgo remote volume up
jmgo remote volume set 20
jmgo remote key left
jmgo remote key ok
jmgo remote key home
jmgo remote watch
```

Status output redacts stable identifiers. Reveal them only when explicitly needed:

```bash
jmgo remote status --include-identifiers
```

Power behavior differs by firmware. Test non-destructive navigation keys first.

## ADB

```bash
jmgo adb info
jmgo adb current
jmgo adb audio
jmgo adb packages youtube
jmgo adb install app.apk
jmgo adb install base.apk split_config.armeabi_v7a.apk split_config.en.apk
jmgo adb launch com.example.app
jmgo adb screenshot projector.png
jmgo adb uninstall com.example.app
```

System applications may not be removable by the ordinary ADB shell. The CLI intentionally does not attempt root access or system partition modification.

## JMGO Artemis Lab, monitor, and application selection

List the active macOS displays that Sunshine can capture:

```bash
jmgo artemis monitors
jmgo artemis monitors --json
```

Open the certified package on the primary or an explicit display:

```bash
jmgo artemis --monitor primary
jmgo artemis --monitor 7
jmgo artemis --monitor "Studio Display"
```

List Sunshine application entries, marking the remembered default, and directly start one by one-based index or exact name:

```bash
jmgo artemis apps
jmgo artemis apps --json
jmgo artemis --app 1
jmgo artemis --app "Desktop"
jmgo artemis --monitor primary --app "Steam Big Picture"

# The last --app is remembered as the default, so later runs can omit it
jmgo artemis open
jmgo artemis open --no-app # skip the default for this launch

# Persist the smooth 1080p60 Sunshine profile and launch directly
jmgo artemis --minimum-fps 30 --monitor 4 --app "Desktop"
```

The app listing reads `apps.json` but emits only indexes and names—never commands, environment variables, or preparation scripts. Direct launch uses Artemis's shortcut activity and the paired Sunshine name. Pass `--pc "NAME"` only when the paired client name differs from `sunshine_name` or the local hostname. A newly added Sunshine entry may require opening that host once in Artemis to refresh its app cache.

Selecting an application asks Sunshine to launch one configured application entry; Sunshine still captures the selected monitor rather than isolating an individual macOS window. Passing `--app` also saves the resolved app name in the jmgo config as the default for bare `jmgo artemis open` runs; `--no-app` skips it once, and if the remembered name no longer exists in `apps.json` the command notes that and opens Artemis plainly.

By default the command updates Sunshine's `output_name` and `minimum_fps_target` only when requested, restarts Sunshine, stops the JMGO Settings process that otherwise performs disruptive Wi-Fi scans, force-stops `com.limelight.noirdebug`, and launches JMGO Artemis Lab or the selected application directly. It automatically prefers `/Applications/Sunshine JMGO.app` when installed; set `JMGO_SUNSHINE_APP` to override it. Restarting first clears orphaned sessions that cause the empty chooser popup. Use `--no-restart` only when deliberately preserving an active Sunshine session; it cannot be combined with `--monitor` or `--minimum-fps`.

The tested streaming profile is H.264, Balanced pacing, 60 FPS, Sunshine `minimum_fps_target = 30`, the [patched macOS capture host](experiments/sunshine-jmgo/README.md), 150 ms of encoded-input lead, a ten-image decoded startup threshold with five copy-ready frames, a 15-image burst queue, and either 1280×720 or 1920×1080. See the [Artemis experiment](experiments/artemis-jmgo/README.md).

## Keyboard, mouse, and touch input over ADB

Send input events straight to the projector with `jmgo adb input`, which wraps the on-device `input` tool. Events follow `input <source> <command> <arg>...`:

```bash
jmgo adb input keyevent KEYCODE_DPAD_DOWN   # navigate
jmgo adb input keyevent KEYCODE_DPAD_OK     # select (or: jmgo adb input keyevent 23)
jmgo adb input keyboard text hello          # type into a focused field
jmgo adb input mouse tap 500 500            # click at coordinates
jmgo adb input touchscreen swipe 100 800 100 100 300   # swipe up
jmgo adb input motionevent DOWN 500 500     # raw motion events
```

Sources include `dpad`, `keyboard`, `mouse`, `touchpad`, `gamepad`, `touchscreen`, `stylus`, and `trackball`. For infrared-style D-pad and volume keys, the native `jmgo remote key` path (TCP 9005) needs no ADB connection. Input behavior can vary by Android TV application.

## Verified Play delivery

First link `gplaydl` directly. Its credentials remain under `~/.config/gplaydl` and are never copied into this project:

```bash
jmgo play link
```

Search and inspect metadata:

```bash
jmgo play search "media player"
jmgo play info org.videolan.vlc
```

Download a TV/ARMv7 split set, verify signer consistency, install it, and delete the temporary APK files:

```bash
jmgo play install org.videolan.vlc
```

Keep downloads only when deliberately requested:

```bash
jmgo play install org.videolan.vlc --keep-downloads ./downloads/vlc
```

### Trust model

1. `gplaydl` downloads from Google Play and checks hashes declared by Google's delivery response.
2. `jmgo-controller` invokes Android SDK `apksigner` on every downloaded APK.
3. Installation is refused if any split is invalid or has a different signing certificate.
4. Original APKs are installed together without merging or re-signing.
5. Temporary downloads use a private directory and are removed after installation.

This verifies transport integrity and split consistency. It does not make an application trustworthy, prove Google endorsement, bypass licensing, or make an uncertified projector Play Protect certified. Applications requiring Google Play Services, Play Integrity, DRM certification, or runtime licensing may still fail.

## Library usage

```ts
import { Remote, discover } from "jmgo-controller";

const hosts = await discover("192.168.1.0/24");
const projector = new Remote(hosts[0]);

console.log(await projector.readState());
await projector.press("volume-down");
```

## Credential policy

Never commit:

- Google credentials, tokens, linking codes, or `gplaydl` configuration
- APK/OBB artifacts that may be licensed or proprietary
- projector serial numbers, Bluetooth addresses, screenshots, or local IP configuration
- `.env`, `config.json`, or authentication caches

The project delegates authentication to `gplaydl link`. Environment variables are inherited by child tools but are never logged by this CLI. See [SECURITY.md](SECURITY.md).

## Agent skills

The repository ships browser-harness-style Agent Skills and declares them as Pi package resources. Install from GitHub with the standard skills CLI:

```bash
npx skills add https://github.com/monotykamary/jmgo-controller
```

| Skill | Use it for |
|---|---|
| [`jmgo-control`](skills/jmgo-control/SKILL.md) | Discovery, native remote keys and volume, ADB app lifecycle, screenshots, and input control |
| [`jmgo-artemis`](skills/jmgo-artemis/SKILL.md) | Building/installing the certified client, opening it without stale-session popups, and choosing the Sunshine monitor or application |
| [`jmgo-stream-test`](skills/jmgo-stream-test/SKILL.md) | Saved HTML motion artifacts, hitch investigation, strict SurfaceFlinger/logcat E2E certification, and latency regressions |

Each skill follows the `SKILL.md` + `scripts/setup` + `scripts/test` layout. Supporting files include:

- `skills/jmgo-control/references/` — native protocol, Bonfire ADB/root safety, and verified Play delivery
- `skills/jmgo-artemis/references/` — certified architecture plus immutable build/deploy procedure
- `skills/jmgo-stream-test/assets/simple-motion.html` — the exact early hitch-reproduction bar
- `skills/jmgo-stream-test/assets/high-detail-motion.html` — the final 1080p60 stress page
- `skills/jmgo-stream-test/assets/latency-clock.html` — qualitative latency experiments, with instrumentation caveats
- `skills/jmgo-stream-test/references/hitch-investigation.md` — eliminated hypotheses and root-cause evidence
- `skills/jmgo-stream-test/references/e2e-certification.md` — acceptance ledger and nonintrusive test protocol
- `skills/jmgo-stream-test/references/measurements.json` — sanitized baseline and certified results

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm pack
pnpm simulate:pacing
```

The headless [decoder-pacing sandbox](experiments/decoder-pacing/README.md) reconstructs measured JMGO frame stalls locally and never contacts the projector. The [JMGO Artemis experiment](experiments/artemis-jmgo/README.md) contains the reproducible client patches, and the [Sunshine JMGO experiment](experiments/sunshine-jmgo/README.md) contains the pinned macOS capture patch. Together with projector scan suppression they achieved sustained hitch-free 720p60 and 1080p60 with audio on hardware.

## License

MIT
