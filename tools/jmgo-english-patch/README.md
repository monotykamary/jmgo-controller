# JMGO Native English

Host-side builder for a firmware-pinned, reversible locale-repair APK for the
tested JMGO S901 Bonfire OS build. The APK follows the MoreLocale approach: it
selects Android's native English locale. It also works around a JMGO Settings
service that kills its process during locale changes and can leave resources
pinned to Chinese.

The app does not draw accessibility overlays, replace text, intercept input, use
the network, or modify vendor APKs.

## Native coverage

On the pinned firmware, selecting native English can recover default English
resources that JMGO's Chinese locale handling otherwise hides:

| Target | Firmware | Native English default strings | Chinese defaults still missing English |
|---|---|---:|---:|
| JMGO Settings | `8.1.571` (`3208`) | 1,271 strings | 547 strings, 5 arrays |
| Bonfire Launcher | `7.6.3.002` (`7603002`) | 123 strings | 1,235 strings, 2 arrays |
| Setup Guide | `2.7.0` (`270`) | 119 strings | 242 strings |
| System UI | `1.1.519` (`519`) | 466 strings | 47 strings, 2 arrays |

These counts are locale-resource audit results, not a guarantee that every
resource appears in normal use. A standard MoreLocale selection can expose the
native defaults generally; this app specifically repairs the JMGO Settings path
that was hiding 1,271 of them. The app cannot translate resources whose default
value is already Chinese. The committed catalogues retain reviewed
English translations for those gaps as an audit and future rooted/system-image
input, but a normal user APK cannot inject them.

Android 11 rejects user-installed runtime resource overlays for these targets
because they declare no `overlayable` groups. External skin, package replacement,
and signer routes are also blocked without root, a writable system partition, or
JMGO's private signing key. Accordingly, the builder does not generate placebo
RRO APKs or use the earlier accessibility-label workaround.

## What the APK does

`Apply Native English` performs a real `en-GB -> en` configuration transition.
Before the transition it stops only
`com.jmgo.setting.x/com.jmgo.setting.SettingService`; that service dynamically
registers a `LOCALE_CHANGED` receiver which otherwise calls `killProcess`.
`DashboardService` and the Settings process remain alive. The app restores
`SettingService` in a `finally` block and verifies that the resulting primary
locale is English.

The app has a TV launcher activity and a boot receiver. Boot repair is enabled by
default and can be disabled in the app. It uses only:

- `android.permission.CHANGE_CONFIGURATION`
- `android.permission.RECEIVE_BOOT_COMPLETED`

`CHANGE_CONFIGURATION` is a privileged grant and must be supplied over ADB after
installation, just as with MoreLocale. The host installer does this explicitly.

## Safety model

`build.mjs` is host-only and never installs, enables, stops, or changes anything
on the projector. With `--serial`, it performs only `pm path` and `adb pull` to
obtain temporary build inputs. It rejects a target unless package name, version,
signing certificate, complete Chinese-default inventory, and source fingerprint
match the pinned firmware.

`install.mjs` is a dry run unless `--apply` is explicitly supplied. Migration:

1. disables only known old JMGO English accessibility components through JMGO's
   existing Hippo API;
2. verifies unrelated accessibility services remain enabled;
3. installs the native-locale APK and grants `CHANGE_CONFIGURATION`;
4. invokes the explicit locale-repair receiver;
5. verifies `persist.sys.locale=en`, an `en` runtime configuration, restored JMGO
   `SettingService`, and no old patch accessibility component.

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

- `jmgo-native-english.apk`
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

## Review and apply the installation plan

Dry run (prints commands only):

```bash
node tools/jmgo-english-patch/install.mjs \
  --serial 192.0.2.10:5555
```

Apply only after review:

```bash
node tools/jmgo-english-patch/install.mjs \
  --serial 192.0.2.10:5555 \
  --apply
```

The package ID remains `com.jmgo.middleware.service`, an unused exact entry in
Hippo's background-cleaner allowlist on the pinned firmware. This does not replace
a JMGO package or grant system identity. The installer migrates the prior
`works.earendil.jmgo.english.patch` package when present.

Rollback uninstalls `com.jmgo.middleware.service`. The selected Android English
locale remains active; uninstalling removes the launcher and boot repair only.

## Test

```bash
node --test tools/jmgo-english-patch/test/*.test.mjs
```
