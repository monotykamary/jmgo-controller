# Bonfire OS ADB and package safety

The tested projector exposed ADB on TCP 5555 without pairing. Treat the LAN as a trust boundary: isolate the projector or use a trusted network.

## Capabilities verified

Ordinary shell ADB can:

- inspect model, Android version, ABIs, foreground activity, and audio routing
- list, install, replace, launch, force-stop, and uninstall user packages
- install split APK sets in one `install-multiple` transaction
- capture the screen
- send keyboard, mouse, and touch input events via `adb shell input` (`jmgo adb input`)

The projector shell can prefix `exec-out screencap` with text. Locate the PNG signature before writing the image; the CLI does this.

## Root

`adb root` behavior was tested during research, then ordinary ADB mode was restored. Root availability is firmware-dependent and is not required by jmgo-controller. Never remount or modify system partitions by default. System apps may be non-removable; report that instead of escalating.

## Package discipline

Before removing an app, list exact package names. Artemis variants used during development had separate IDs; the final supported package is:

```text
com.limelight.noirdebug
```

Do not infer package identity from a launcher label. Never commit APKs, app data, screenshots, package databases, or device identifiers.

## Input control

Keyboard, mouse, and touch events go through the on-device `input` tool (`jmgo adb input`). Mouse and touch are issued as absolute commands (`tap`, `swipe`, `motionevent`) rather than a live relative cursor; D-pad and text entry are the most reliable paths on Android TV.
