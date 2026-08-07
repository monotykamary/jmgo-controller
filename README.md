# jmgo-controller

An unofficial, local-first CLI for JMGO projectors running Bonfire OS. It combines the projector's native LAN remote protocol, Android Debug Bridge automation, and an optional verified Google Play delivery pipeline.

The protocol was validated on a JMGO S901 running Bonfire OS. Other models may use different key codes or transports. This project is not affiliated with JMGO or Google.

## Features

- Read projector state, including current volume and firmware information.
- Send navigation, volume, home, settings, and power key events over TCP port 9005.
- List, install, uninstall, and launch Android applications through ADB.
- Capture screenshots and inspect the foreground Android activity.
- Download device-targeted Play APK splits with `gplaydl`, verify every split has the same Google signing certificate, and install them in one ADB session.
- Redact serial numbers and Bluetooth addresses from status output by default.

## Security warning

Some Bonfire OS builds expose unauthenticated ADB over the local network. Anyone who can reach TCP port 5555 may be able to inspect or control the projector. Put the projector on a trusted network or isolated IoT VLAN.

`jmgo-controller` never asks for, reads, stores, or prints Google passwords, 2FA codes, Play tokens, or API keys. Optional Play authentication belongs entirely to `gplaydl` and lives outside this repository under its own configuration directory. Use a separate Google account: unofficial Play clients can cause account restrictions.

## Requirements

- Python 3.10 or newer
- A JMGO projector reachable on the same LAN
- Android Platform Tools for ADB commands
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
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
export JMGO_HOST=192.168.1.50
```

Or install the CLI in an isolated environment:

```bash
pipx install .
```

Find the projector and run diagnostics:

```bash
jmgo discover
# For a larger or different subnet:
jmgo discover --network 192.168.0.0/22
jmgo doctor
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

Status output redacts stable device identifiers. Reveal them only when explicitly needed:

```bash
jmgo remote status --include-identifiers
```

Power key behavior differs by firmware. Test non-destructive navigation keys first.

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

Keep downloaded files only when deliberately requested:

```bash
jmgo play install org.videolan.vlc --keep-downloads ./downloads/vlc
```

Downloaded APKs, OBBs, token files, and common secret files are ignored by Git. Before every release, inspect `git status` and use a secret scanner.

### Trust model

1. `gplaydl` downloads APKs from Google Play and checks the SHA-256 hashes declared by Google's delivery response.
2. `jmgo-controller` invokes the Android SDK's `apksigner` on every downloaded APK.
3. Installation is refused if any split is invalid or has a different signing certificate.
4. Original APKs are installed together without merging or re-signing.
5. Temporary downloads use a private directory and are removed after installation.

This verifies transport integrity and split consistency. It does not make an application trustworthy, prove Google endorsement, bypass licensing, or make an uncertified projector Play Protect certified. Applications requiring Google Play Services, Play Integrity, DRM certification, or runtime licensing may still fail.

## Credential policy

Never commit:

- Google credentials, tokens, linking codes, or `gplaydl` configuration
- APK/OBB artifacts that may be licensed or proprietary
- projector serial numbers, Bluetooth addresses, screenshots, or local IP configuration
- `.env`, `config.json`, or authentication caches

The project passes control to `gplaydl link` instead of implementing authentication. Environment variables are inherited by child tools but are never logged by this CLI. See [SECURITY.md](SECURITY.md) for reporting guidance.

## Development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest
ruff check .
```

## License

MIT
