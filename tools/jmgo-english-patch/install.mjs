#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const VENDOR_ACTION = "action.jmgo.request.accessibility.service";
const VENDOR_COMPONENT_EXTRA = "compontentNameStr";
const VENDOR_SERVICE = "com.jmgo.hippo/com.jmgo.middleware.service.JmgoKeyAccessibilityService";
const PATCH_BOUND_MARKER = "Service[label=JMGO English Patch,";

function parseArgs(argv) {
  const options = { artifacts: join(ROOT, ".build", "artifacts"), apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if ((argument === "--serial" || argument === "--artifacts") && argv[index + 1]) {
      options[argument === "--serial" ? "serial" : "artifacts"] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete option: ${argument}`);
  }
  if (!options.serial) throw new Error("--serial is required");
  options.artifacts = resolve(options.artifacts);
  return options;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandLine(command, args) {
  return [command, ...args.map(shellQuote)].join(" ");
}

function run(command, args) {
  console.log(`> ${commandLine(command, args)}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function canonicalComponent(value) {
  const separator = value.indexOf("/");
  if (separator < 1) return value;
  const packageName = value.slice(0, separator);
  const className = value.slice(separator + 1);
  return `${packageName}/${className.startsWith(".") ? packageName + className : className}`;
}

function enabledServices(serial) {
  const value = execFileSync(
    "adb",
    ["-s", serial, "shell", "settings", "get", "secure", "enabled_accessibility_services"],
    { encoding: "utf8" },
  ).trim();
  return value === "null" || value === "" ? [] : value.split(":").filter(Boolean);
}

function accessibilityState(serial, packageName) {
  const dump = execFileSync("adb", ["-s", serial, "shell", "dumpsys", "accessibility"], { encoding: "utf8" });
  const boundStart = dump.indexOf("Bound services:");
  const enabledStart = dump.indexOf("Enabled services:", boundStart);
  const crashedStart = dump.indexOf("Crashed services:", enabledStart);
  const bound = boundStart >= 0 && enabledStart > boundStart ? dump.slice(boundStart, enabledStart) : "";
  const crashed = crashedStart >= 0 ? dump.slice(crashedStart) : "";
  return { bound: bound.includes(PATCH_BOUND_MARKER), crashed: crashed.includes(packageName) };
}

function waitUntilBound(serial, packageName) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = accessibilityState(serial, packageName);
    if (state.bound && !state.crashed) return;
    execFileSync("adb", ["-s", serial, "shell", "sleep", "1"]);
  }
  const state = accessibilityState(serial, packageName);
  throw new Error(`English accessibility service did not bind cleanly (bound=${state.bound}, crashed=${state.crashed})`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const metadata = JSON.parse(readFileSync(join(ROOT, "catalogs", "targets.json"), "utf8"));
  const apk = join(options.artifacts, "jmgo-english-accessibility.apk");
  if (!existsSync(apk)) throw new Error("Missing artifact: jmgo-english-accessibility.apk");

  const packageName = metadata.companionPackage;
  const service = `${packageName}/${packageName}.EnglishAccessibilityService`;
  const install = ["adb", ["-s", options.serial, "install", "-r", apk]];
  const vendorCommand = (enabled) => ["adb", [
    "-s", options.serial, "shell", "am", "broadcast", "-a", VENDOR_ACTION,
    "--es", VENDOR_COMPONENT_EXTRA, service, "--ez", "enabled", String(enabled),
  ]];
  const disable = vendorCommand(false);
  const enable = vendorCommand(true);

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to modify the projector:\n");
    for (const [command, args] of [install, disable, enable]) console.log(commandLine(command, args));
    console.log("\nRollback:");
    console.log(commandLine(...disable));
    console.log(commandLine("adb", ["-s", options.serial, "uninstall", packageName]));
    return;
  }

  const before = enabledServices(options.serial);
  if (!new Set(before.map(canonicalComponent)).has(canonicalComponent(VENDOR_SERVICE))) {
    throw new Error("JMGO Hippo accessibility service is not enabled; refusing unsafe activation");
  }

  run(...install);
  run(...disable);
  run(...enable);
  waitUntilBound(options.serial, packageName);

  const after = enabledServices(options.serial);
  const afterCanonical = new Set(after.map(canonicalComponent));
  const removed = before
    .filter((component) => canonicalComponent(component) !== canonicalComponent(service))
    .filter((component) => !afterCanonical.has(canonicalComponent(component)));
  if (removed.length > 0) throw new Error(`Activation removed existing accessibility services: ${removed.join(", ")}`);
  if (!afterCanonical.has(canonicalComponent(service))) throw new Error("English accessibility service was not enabled");

  console.log("JMGO English Patch is installed and its service is active through the vendor accessibility API.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
