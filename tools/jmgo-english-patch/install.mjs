#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const VENDOR_ACTION = "action.jmgo.request.accessibility.service";
const VENDOR_COMPONENT_EXTRA = "compontentNameStr";
const VENDOR_SERVICE = "com.jmgo.hippo/com.jmgo.middleware.service.JmgoKeyAccessibilityService";

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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const metadata = JSON.parse(readFileSync(join(ROOT, "catalogs", "targets.json"), "utf8"));
  const apk = join(options.artifacts, "jmgo-english-accessibility.apk");
  if (!existsSync(apk)) throw new Error("Missing artifact: jmgo-english-accessibility.apk");

  const packageName = metadata.companionPackage;
  const service = `${packageName}/${packageName}.EnglishAccessibilityService`;
  const install = ["adb", ["-s", options.serial, "install", "-r", apk]];
  const enable = ["adb", ["-s", options.serial, "shell", "am", "broadcast", "-a", VENDOR_ACTION, "--es", VENDOR_COMPONENT_EXTRA, service, "--ez", "enabled", "true"]];
  const launch = ["adb", ["-s", options.serial, "shell", "am", "start", "-W", "-n", `${packageName}/.MainActivity`]];
  const disable = ["adb", ["-s", options.serial, "shell", "am", "broadcast", "-a", VENDOR_ACTION, "--es", VENDOR_COMPONENT_EXTRA, service, "--ez", "enabled", "false"]];

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to modify the projector:\n");
    for (const [command, args] of [install, enable, launch]) console.log(commandLine(command, args));
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
  run(...enable);
  execFileSync("adb", ["-s", options.serial, "shell", "sleep", "1"]);

  const after = enabledServices(options.serial);
  const afterCanonical = new Set(after.map(canonicalComponent));
  const removed = before.filter((component) => !afterCanonical.has(canonicalComponent(component)));
  if (removed.length > 0) throw new Error(`Activation removed existing accessibility services: ${removed.join(", ")}`);
  if (!afterCanonical.has(canonicalComponent(service))) throw new Error("English accessibility service was not enabled");

  run(...launch);
  console.log("JMGO English Patch is installed and active through the vendor accessibility API.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
