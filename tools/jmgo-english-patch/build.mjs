#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAccessibilityCatalog,
  parseAapt2Resources,
  validateCatalog,
} from "./lib.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(ROOT, ".build", "artifacts");

function usage() {
  console.log(`Usage: node tools/jmgo-english-patch/build.mjs [options]

Build only; this command never installs or enables anything on the projector.

Options:
  --serial SERIAL       Pull supported APKs read-only from this ADB device
  --apk-dir PATH        Use settings.apk, launcher.apk, guide.apk, and systemui.apk from PATH
  --output PATH         Artifact directory (default: tools/jmgo-english-patch/.build/artifacts)
  --keystore PATH       Signing keystore; otherwise a persistent local debug key is generated
  --alias NAME          Keystore alias (default: jmgo-english-patch)
  --keep-work           Retain generated host-side work files
  --help                Show this help

Custom keystores read passwords from JMGO_PATCH_KEYSTORE_PASSWORD and
JMGO_PATCH_KEY_PASSWORD. Never delete a key used for an installed build: Android
requires the same signer for upgrades.`);
}

function parseArgs(argv) {
  const options = { output: DEFAULT_OUTPUT, alias: "jmgo-english-patch", keepWork: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (argument === "--keep-work") {
      options.keepWork = true;
      continue;
    }
    const key = { "--serial": "serial", "--apk-dir": "apkDir", "--output": "output", "--keystore": "keystore", "--alias": "alias" }[argument];
    if (!key || index + 1 >= argv.length) throw new Error(`Unknown or incomplete option: ${argument}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  if (Boolean(options.serial) === Boolean(options.apkDir)) throw new Error("Choose exactly one of --serial or --apk-dir");
  options.output = resolve(options.output);
  if (options.apkDir) options.apkDir = resolve(options.apkDir);
  if (options.keystore) options.keystore = resolve(options.keystore);
  return options;
}

let JAVA_ENV = process.env;

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: options.binary ? undefined : "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      env: options.env ?? JAVA_ENV,
    });
  } catch (error) {
    const stderr = error.stderr?.toString?.().trim();
    throw new Error(`${basename(command)} ${args.join(" ")} failed${stderr ? `:\n${stderr}` : ""}`, { cause: error });
  }
}

function commandExists(command) {
  try {
    run("/usr/bin/env", ["which", command]);
    return true;
  } catch {
    return false;
  }
}

function numericDirectorySort(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function discoverSdk() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    "/opt/homebrew/share/android-commandlinetools",
    join(process.env.HOME ?? "", "Library", "Android", "sdk"),
  ].filter(Boolean);
  const sdk = candidates.find((candidate) => existsSync(join(candidate, "build-tools")) && existsSync(join(candidate, "platforms")));
  if (!sdk) throw new Error("Android SDK not found; set ANDROID_SDK_ROOT");

  const buildVersions = readdirSync(join(sdk, "build-tools")).sort(numericDirectorySort).reverse();
  const buildTools = buildVersions.map((version) => join(sdk, "build-tools", version)).find((path) => ["aapt2", "d8", "zipalign", "apksigner"].every((tool) => existsSync(join(path, tool))));
  if (!buildTools) throw new Error("Android SDK Build Tools with aapt2, d8, zipalign, and apksigner are required");

  const platforms = readdirSync(join(sdk, "platforms")).sort(numericDirectorySort).reverse();
  const androidJar = platforms.map((platform) => join(sdk, "platforms", platform, "android.jar")).find(existsSync);
  if (!androidJar) throw new Error("Android platform android.jar not found");
  return { sdk, buildTools, androidJar };
}

function discoverJava() {
  const homes = [process.env.JAVA_HOME, "/opt/homebrew/opt/openjdk@21", "/opt/homebrew/opt/openjdk"].filter(Boolean);
  const home = homes.find((candidate) => existsSync(join(candidate, "bin", "javac")) && existsSync(join(candidate, "bin", "keytool")));
  if (home) return { home, javac: join(home, "bin", "javac"), keytool: join(home, "bin", "keytool"), jar: join(home, "bin", "jar") };
  if (commandExists("javac") && commandExists("keytool") && commandExists("jar")) return { home: process.env.JAVA_HOME, javac: "javac", keytool: "keytool", jar: "jar" };
  throw new Error("JDK 17 or newer is required; set JAVA_HOME");
}

function readMetadata() {
  const metadata = JSON.parse(readFileSync(join(ROOT, "catalogs", "targets.json"), "utf8"));
  const catalogs = Object.fromEntries(metadata.targets.map((target) => [target.id, JSON.parse(readFileSync(join(ROOT, "catalogs", `${target.id}.json`), "utf8"))]));
  return { metadata, catalogs };
}

function pullApks(targets, serial, directory) {
  if (!commandExists("adb")) throw new Error("adb is required with --serial");
  const paths = {};
  for (const target of targets) {
    const output = run("adb", ["-s", serial, "shell", "pm", "path", target.packageName]);
    const devicePath = output.split(/\r?\n/u).map((line) => line.replace(/^package:/u, "").trim()).find((line) => line.endsWith(".apk"));
    if (!devicePath) throw new Error(`Could not locate ${target.packageName} on ${serial}`);
    const destination = join(directory, `${target.id}.apk`);
    run("adb", ["-s", serial, "pull", devicePath, destination]);
    paths[target.id] = destination;
  }
  return paths;
}

function localApks(targets, directory) {
  const paths = {};
  for (const target of targets) {
    const path = join(directory, `${target.id}.apk`);
    if (!existsSync(path)) throw new Error(`Missing ${path}`);
    paths[target.id] = path;
  }
  return paths;
}

function parseBadging(output) {
  const packageLine = output.split(/\r?\n/u).find((line) => line.startsWith("package:")) ?? "";
  const read = (name) => new RegExp(`${name}='([^']*)'`, "u").exec(packageLine)?.[1];
  return {
    packageName: read("name"),
    versionCode: Number(read("versionCode")),
    versionName: read("versionName"),
    targetSdk: Number(/targetSdkVersion:'(\d+)'/u.exec(output)?.[1]),
  };
}

function inspectApk(path, target, tools) {
  const badging = parseBadging(run(join(tools.buildTools, "aapt2"), ["dump", "badging", path]));
  const certOutput = run(join(tools.buildTools, "apksigner"), ["verify", "--print-certs", path]);
  const certificateSha256 = /certificate SHA-256 digest: ([0-9a-f]+)/iu.exec(certOutput)?.[1]?.toLowerCase();
  const failures = [];
  if (badging.packageName !== target.packageName) failures.push(`package ${badging.packageName}`);
  if (badging.versionCode !== target.versionCode) failures.push(`versionCode ${badging.versionCode}`);
  if (badging.versionName !== target.versionName) failures.push(`versionName ${badging.versionName}`);
  if (badging.targetSdk !== target.targetSdk) failures.push(`targetSdk ${badging.targetSdk}`);
  if (certificateSha256 !== target.certificateSha256) failures.push(`certificate ${certificateSha256}`);
  if (failures.length > 0) throw new Error(`${target.id}.apk is unsupported: ${failures.join(", ")}`);
  return badging;
}

function ensureSigning(options, java) {
  const keystore = options.keystore ?? join(ROOT, ".build", "signing", "jmgo-english-patch-debug.jks");
  const customSecret = process.env.JMGO_PATCH_KEYSTORE_PASSWORD;
  const storeSecret = options.keystore ? customSecret : "android";
  const keySecret = options.keystore ? (process.env.JMGO_PATCH_KEY_PASSWORD ?? customSecret) : "android";
  if (!storeSecret) throw new Error("JMGO_PATCH_KEYSTORE_PASSWORD is required with --keystore");
  if (!existsSync(keystore)) {
    if (options.keystore) throw new Error(`Keystore does not exist: ${keystore}`);
    mkdirSync(dirname(keystore), { recursive: true });
    run(java.keytool, [
      "-genkeypair", "-noprompt", "-storetype", "JKS", "-keystore", keystore,
      "-storepass", storeSecret, "-keypass", keySecret, "-alias", options.alias,
      "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
      "-dname", "CN=JMGO English Patch Debug, OU=Local Build, O=jmgo-controller",
    ]);
  }
  return { keystore, storeSecret, keySecret, alias: options.alias };
}

function signApk(unsigned, destination, signing, tools) {
  const aligned = `${unsigned}.aligned.apk`;
  run(join(tools.buildTools, "zipalign"), ["-p", "-f", "4", unsigned, aligned]);
  const env = { ...JAVA_ENV, JMGO_PATCH_STORE_PASS: signing.storeSecret, JMGO_PATCH_KEY_PASS: signing.keySecret };
  run(join(tools.buildTools, "apksigner"), [
    "sign", "--min-sdk-version", "23", "--v1-signing-enabled", "true", "--v2-signing-enabled", "true", "--v3-signing-enabled", "true", "--v4-signing-enabled", "false", "--ks", signing.keystore, "--ks-key-alias", signing.alias,
    "--ks-pass", "env:JMGO_PATCH_STORE_PASS", "--key-pass", "env:JMGO_PATCH_KEY_PASS",
    "--out", destination, aligned,
  ], { env });
  run(join(tools.buildTools, "apksigner"), ["verify", "--verbose", "--min-sdk-version", "23", destination]);
}

function listJavaSources(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listJavaSources(path));
    else if (entry.name.endsWith(".java")) output.push(path);
  }
  return output;
}

function buildCompanion(accessibilityCatalog, work, output, signing, tools, java, version) {
  const directory = join(work, "companion");
  const classes = join(directory, "classes");
  const dex = join(directory, "dex");
  const assets = join(directory, "assets");
  const compiled = join(directory, "compiled.zip");
  mkdirSync(classes, { recursive: true });
  mkdirSync(dex, { recursive: true });
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, "translations.json"), `${JSON.stringify(accessibilityCatalog)}\n`);

  const sources = listJavaSources(join(ROOT, "android", "src"));
  run(java.javac, ["-encoding", "UTF-8", "-source", "8", "-target", "8", "-classpath", tools.androidJar, "-d", classes, ...sources]);
  const classesJar = join(directory, "classes.jar");
  run(java.jar, ["cf", classesJar, "-C", classes, "."]);
  run(join(tools.buildTools, "d8"), ["--lib", tools.androidJar, "--min-api", "30", "--output", dex, classesJar]);
  run(join(tools.buildTools, "aapt2"), ["compile", "--dir", join(ROOT, "android", "res"), "-o", compiled]);

  const unsigned = join(directory, "unsigned.apk");
  run(join(tools.buildTools, "aapt2"), [
    "link", "--manifest", join(ROOT, "android", "AndroidManifest.xml"), "-I", tools.androidJar,
    "--min-sdk-version", "30", "--target-sdk-version", "30", "--version-code", String(version.code), "--version-name", version.name,
    "-A", assets, "-o", unsigned, compiled,
  ]);
  run("zip", ["-q", "-j", unsigned, join(dex, "classes.dex")]);
  const destination = join(output, "jmgo-english-accessibility.apk");
  signApk(unsigned, destination, signing, tools);
  return destination;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const tools = discoverSdk();
  const java = discoverJava();
  JAVA_ENV = java.home ? { ...process.env, JAVA_HOME: java.home, PATH: `${join(java.home, "bin")}:${process.env.PATH ?? ""}` } : process.env;
  const { metadata, catalogs } = readMetadata();
  const signing = ensureSigning(options, java);
  const work = mkdtempSync(join(tmpdir(), "jmgo-english-patch-"));
  mkdirSync(options.output, { recursive: true });

  try {
    const apks = options.serial ? pullApks(metadata.targets, options.serial, work) : localApks(metadata.targets, options.apkDir);
    const resources = {};
    const reports = [];
    for (const target of metadata.targets) {
      inspectApk(apks[target.id], target, tools);
      const dump = run(join(tools.buildTools, "aapt2"), ["dump", "resources", apks[target.id]]);
      resources[target.id] = parseAapt2Resources(dump);
      reports.push({ id: target.id, ...validateCatalog(resources[target.id], catalogs[target.id], target) });
    }

    const artifacts = [];
    const accessibility = buildAccessibilityCatalog(metadata.targets, resources, catalogs);
    if (accessibility.conflicts.length > 0) throw new Error(`Accessibility catalogue conflicts: ${accessibility.conflicts.join(", ")}`);
    delete accessibility.conflicts;
    artifacts.push(buildCompanion(accessibility, work, options.output, signing, tools, java, {
      code: metadata.patchVersionCode,
      name: metadata.patchVersion,
    }));

    const artifactManifest = {
      schemaVersion: 1,
      patchVersion: metadata.patchVersion,
      generatedAt: new Date().toISOString(),
      targets: reports,
      artifacts: artifacts.map((path) => ({ file: basename(path), sha256: sha256(path) })),
    };
    writeFileSync(join(options.output, "manifest.json"), `${JSON.stringify(artifactManifest, null, 2)}\n`);
    console.log(`Built ${artifacts.length} signed APK${artifacts.length === 1 ? "" : "s"} in ${options.output}`);
    for (const artifact of artifacts) console.log(`  ${basename(artifact)}  ${sha256(artifact)}`);
    console.log("No projector packages, settings, overlays, or services were changed.");
  } finally {
    if (options.keepWork) console.log(`Retained work directory: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
