# Bonfire OS ADB and package safety

The tested projector exposed ADB on TCP 5555 without pairing. Treat the LAN as a trust boundary: isolate the projector or use a trusted network.

## Capabilities verified

Ordinary shell ADB can:

- inspect model, Android version, ABIs, foreground activity, and audio routing
- list, install, replace, launch, force-stop, and uninstall user packages
- install split APK sets in one `install-multiple` transaction
- capture the screen
- provide UHID keyboard/mouse control through scrcpy

The projector shell can prefix `exec-out screencap` with text. Locate the PNG signature before writing the image; the CLI does this.

## Root

`adb root` behavior was tested during research, then ordinary ADB mode was restored. Root availability is firmware-dependent and is not required by jmgo-controller. Never remount or modify system partitions by default. System apps may be non-removable; report that instead of escalating.

## Package discipline

Before removing an app, list exact package names. Artemis variants used during development had separate IDs; the final supported package is:

```text
com.limelight.noirdebug
```

Do not infer package identity from a launcher label. Never commit APKs, app data, screenshots, package databases, or device identifiers.

## scrcpy

The default CLI uses `--no-video --no-audio --mouse=uhid --keyboard=uhid`, turning a Mac keyboard and trackpad into control devices without a redundant mirror. `--mirror` is opt-in.
