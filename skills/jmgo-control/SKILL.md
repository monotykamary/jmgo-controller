---
name: jmgo-control
description: >-
  Operate a JMGO projector from the terminal through the jmgo-controller CLI:
  discover and save its host, inspect/redact state, send remote keys and volume,
  manage Android packages through ADB, capture screenshots, and use scrcpy HID
  control. Use for local projector automation or diagnostics. Requires jmgo on
  PATH, with ADB enabled for Android operations.
setup: bash scripts/setup
compatibility: >-
  Node.js 20+, jmgo-controller on PATH, and a JMGO projector on the same LAN.
  ADB commands require Android Platform Tools and TCP 5555; scrcpy is optional.
---

# JMGO control

Use `jmgo-control` as a transparent alias for `jmgo`.

## Establish the target

```bash
jmgo-control discover
jmgo-control discover set
jmgo-control host show
jmgo-control doctor
```

Target priority is `--host`, `JMGO_HOST`, then the private saved configuration. Never put a local IP, serial number, or device identifier into source files or skill output intended for commit.

## Native remote

```bash
jmgo-control remote status
jmgo-control remote volume
jmgo-control remote volume down
jmgo-control remote volume set 20
jmgo-control remote key left
jmgo-control remote key ok
jmgo-control remote key home
jmgo-control remote watch
```

State is identifier-redacted unless `--include-identifiers` is explicitly requested. Prefer non-destructive navigation before power commands on an unfamiliar firmware.

## ADB

```bash
jmgo-control adb info
jmgo-control adb current
jmgo-control adb audio
jmgo-control adb packages artemis
jmgo-control adb install app.apk
jmgo-control adb launch com.example.app
jmgo-control adb screenshot /tmp/projector.png
jmgo-control adb uninstall com.example.app
```

Bonfire OS can prefix binary shell output. The screenshot command strips that preamble and writes a valid PNG. Do not commit projector screenshots or APKs.

## Keyboard and pointer

```bash
jmgo-control scrcpy
jmgo-control scrcpy --mirror
jmgo-control scrcpy --mirror -- --max-fps=30 --stay-awake
```

The default is control-only UHID input with no mirrored video or audio.

## Certified streaming client

Use the `jmgo-artemis` skill for Sunshine monitor selection, stale-session prevention, building the patched client, and opening JMGO Artemis Lab.

Load [references/native-protocol.md](references/native-protocol.md) before changing packet semantics, [references/bonfire-adb.md](references/bonfire-adb.md) for ADB/root/package safety, and [references/verified-play.md](references/verified-play.md) for Play split delivery and its trust boundary.
