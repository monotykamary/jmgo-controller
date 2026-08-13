# JMGO English patch

Host-side builder for a firmware-pinned, reversible English patch APK for the
tested JMGO S901 Bonfire OS build. It does not contain JMGO APKs or Chinese
firmware resources. The committed catalogues contain English replacement values
keyed by Android resource name.

## Coverage

| Target | Firmware | Catalogued coverage |
|---|---|---:|
| JMGO Settings | `8.1.571` (`3208`) | 547 strings, 5 arrays |
| Bonfire Launcher | `7.6.3.002` (`7603002`) | 1,235 strings, 2 arrays |
| Setup Guide | `2.7.0` (`270`) | 242 strings |
| System UI | `1.1.519` (`519`) | 47 strings, 2 arrays |

The APK is an offline, package-scoped accessibility service. It reads visible
accessibility text, matches known Chinese strings, and draws non-touchable
English labels over them. The overlay never intercepts remote input. It has no
network permission and does not click, type, collect, store, or transmit data.

This is the most complete patch available without JMGO's private signing key,
root, or a writable system partition. Android 11 rejects a user-installed
runtime resource overlay when the target defines no `overlayable` resources,
unless that overlay is preinstalled or signed with the target's key. All four
JMGO targets on this firmware define no overlayable groups, so this project does
not generate placebo RRO APKs.

The patch can only cover text exposed through Android's accessibility node tree.
Text rendered inside images, video, OpenGL/SurfaceView, inaccessible WebViews,
or remote server content is outside its reach. The initial catalogue was
machine-assisted and critical projector terminology was reviewed, but all
2,000+ strings have not received native-speaker review. Treat this as a
functional translation patch rather than an official localization.

## Safety model

`build.mjs` is host-only and never installs, enables, stops, or changes anything
on the projector. With `--serial`, it performs only `pm path` and `adb pull` to
obtain temporary build inputs. It rejects a target unless package name,
version, signing certificate, complete Chinese-resource inventory, and source
fingerprint match the pinned firmware.

`install.mjs` is a dry run unless `--apply` is explicitly supplied. On this
firmware it activates the patch through JMGO Hippo's existing accessibility
service API and verifies that all previously enabled services remain present.

Do not delete the generated signing keystore after installing a build. Android
requires the same signer for later upgrades. For release builds, use your own
keystore instead of the generated local debug key.

## Prerequisites

- Node.js 20+
- JDK 17+
- Android SDK platform and Build Tools (`aapt2`, `d8`, `zipalign`, `apksigner`)
- `adb` only when reading targets from the projector or applying a reviewed plan

The builder checks `ANDROID_SDK_ROOT`, `ANDROID_HOME`, Homebrew's command-line
tools location, and the default macOS Android SDK location.

## Build without changing the projector

Read the four target APKs over ADB and build locally:

```bash
node tools/jmgo-english-patch/build.mjs \
  --serial 192.0.2.10:5555
```

Or build from an existing private directory containing exactly:

```text
settings.apk
launcher.apk
guide.apk
systemui.apk
```

```bash
node tools/jmgo-english-patch/build.mjs \
  --apk-dir /private/path/to/target-apks
```

Output defaults to `tools/jmgo-english-patch/.build/artifacts/` and is ignored by
Git. The builder generates:

- `jmgo-english-accessibility.apk`
- `manifest.json`

The default key is generated at
`tools/jmgo-english-patch/.build/signing/jmgo-english-patch-debug.jks`.
For a private release key:

```bash
export JMGO_PATCH_KEYSTORE_PASSWORD='...'
export JMGO_PATCH_KEY_PASSWORD='...'
node tools/jmgo-english-patch/build.mjs \
  --apk-dir /private/path/to/target-apks \
  --keystore /private/path/to/release.jks \
  --alias jmgo-english-patch
```

## Review the future installation plan

This prints commands only:

```bash
node tools/jmgo-english-patch/install.mjs \
  --serial 192.0.2.10:5555
```

Only after review, a later session can explicitly apply it:

```bash
node tools/jmgo-english-patch/install.mjs \
  --serial 192.0.2.10:5555 \
  --apply
```

The installer installs the single APK and activates its accessibility service.
JMGO firmware blocks direct ADB edits and does not expose Android's standard
Accessibility settings screen, but its already-enabled Hippo key service exposes
`action.jmgo.request.accessibility.service` for this purpose. The installer uses
that vendor API, verifies that every previously enabled service remains present,
and grants the patch no secure-settings permission.

The dry-run output also prints a vendor-API disable command followed by the
uninstall command for complete rollback.

## Test

```bash
node --test tools/jmgo-english-patch/test/*.test.mjs
```
