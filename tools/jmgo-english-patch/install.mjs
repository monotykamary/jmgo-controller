#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = "jmgo-native-english.apk";
const CHANGE_CONFIGURATION = "android.permission.CHANGE_CONFIGURATION";
const APPLY_ACTION = "com.jmgo.middleware.service.APPLY_NATIVE_ENGLISH";
const VENDOR_ACTION = "action.jmgo.request.accessibility.service";
const VENDOR_COMPONENT_EXTRA = "compontentNameStr";
const VENDOR_SERVICE = "com.jmgo.hippo/com.jmgo.middleware.service.JmgoKeyAccessibilityService";
const SETTINGS_PACKAGE = "com.jmgo.setting.x";
const SETTINGS_SERVICE = "com.jmgo.setting.SettingService";
const DASHBOARD_SERVICE = "com.jmgo.setting.DashboardService";

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

function run(command, args, capture = false) {
  console.log(`> ${commandLine(command, args)}`);
  if (!capture) {
    execFileSync(command, args, { stdio: "inherit" });
    return "";
  }
  const output = execFileSync(command, args, { encoding: "utf8" });
  if (output.trim()) console.log(output.trim());
  return output;
}

function adb(serial, ...args) {
  return execFileSync("adb", ["-s", serial, ...args], { encoding: "utf8" }).trim();
}

function canonicalComponent(value) {
  const separator = value.indexOf("/");
  if (separator < 1) return value;
  const packageName = value.slice(0, separator);
  const className = value.slice(separator + 1);
  return `${packageName}/${className.startsWith(".") ? packageName + className : className}`;
}

function component(packageName, className) {
  return `${packageName}/${className.startsWith(".") ? packageName + className : className}`;
}

function serviceComponent(packageName) {
  return component(packageName, ".EnglishAccessibilityService");
}

function receiverComponent(packageName) {
  return component(packageName, ".LocaleRepairReceiver");
}

function enabledServices(serial) {
  const value = adb(serial, "shell", "settings", "get", "secure", "enabled_accessibility_services");
  return value === "null" || value === "" ? [] : value.split(":").filter(Boolean);
}

function packageInstalled(serial, packageName) {
  try {
    return adb(serial, "shell", "pm", "path", packageName) !== "";
  } catch {
    return false;
  }
}

function permissionGranted(serial, packageName) {
  const dump = adb(serial, "shell", "dumpsys", "package", packageName);
  return dump.includes(`${CHANGE_CONFIGURATION}: granted=true`);
}

function nativeEnglishState(serial) {
  const locale = adb(serial, "shell", "getprop", "persist.sys.locale");
  const config = adb(serial, "shell", "am", "get-config").split(/\r?\n/u)[0] ?? "";
  const services = adb(serial, "shell", "dumpsys", "activity", "services", SETTINGS_PACKAGE);
  return {
    locale,
    config,
    pid: adb(serial, "shell", "pidof", SETTINGS_PACKAGE),
    settingService: services.includes(SETTINGS_SERVICE),
    dashboardService: services.includes(DASHBOARD_SERVICE),
  };
}

function waitForNativeEnglish(serial) {
  let state = nativeEnglishState(serial);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (state.locale === "en" && /^config:\s+en-ldltr-/u.test(state.config) && state.settingService) return state;
    execFileSync("adb", ["-s", serial, "shell", "sleep", "1"]);
    state = nativeEnglishState(serial);
  }
  throw new Error(
    `Native English verification failed (locale=${state.locale || "unset"}, config=${state.config || "unset"}, SettingService=${state.settingService})`
  );
}

function vendorCommand(serial, service, enabled) {
  return ["adb", [
    "-s", serial, "shell", "am", "broadcast", "-a", VENDOR_ACTION,
    "--es", VENDOR_COMPONENT_EXTRA, service, "--ez", "enabled", String(enabled),
  ]];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const metadata = JSON.parse(readFileSync(join(ROOT, "catalogs", "targets.json"), "utf8"));
  const apk = join(options.artifacts, ARTIFACT);
  if (!existsSync(apk)) throw new Error(`Missing artifact: ${ARTIFACT}`);

  const packageName = metadata.companionPackage;
  const legacyPackages = metadata.legacyCompanionPackages ?? [];
  const oldServices = [packageName, ...legacyPackages].map(serviceComponent);
  const oldCanonical = new Set(oldServices.map(canonicalComponent));
  const disableOld = oldServices.map((service) => vendorCommand(options.serial, service, false));
  const install = ["adb", ["-s", options.serial, "install", "-r", apk]];
  const grant = ["adb", ["-s", options.serial, "shell", "pm", "grant", packageName, CHANGE_CONFIGURATION]];
  const repair = ["adb", [
    "-s", options.serial, "shell", "am", "broadcast", "--receiver-foreground",
    "-a", APPLY_ACTION, "-n", receiverComponent(packageName),
  ]];

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to modify the projector:\n");
    for (const [command, args] of disableOld) console.log(commandLine(command, args));
    for (const [command, args] of [install, grant, repair]) console.log(commandLine(command, args));
    for (const legacy of legacyPackages) console.log(commandLine("adb", ["-s", options.serial, "uninstall", legacy]));
    console.log("\nRollback:");
    console.log(commandLine("adb", ["-s", options.serial, "uninstall", packageName]));
    console.log("The native English locale remains selected; rollback removes only boot repair and the launcher app.");
    return;
  }

  const before = enabledServices(options.serial);
  const beforeCanonical = new Set(before.map(canonicalComponent));
  const oldEnabled = oldServices.some((service) => beforeCanonical.has(canonicalComponent(service)));
  if (oldEnabled && !beforeCanonical.has(canonicalComponent(VENDOR_SERVICE))) {
    throw new Error("An old English accessibility service is enabled but JMGO Hippo is unavailable; refusing an unsafe migration");
  }
  const preserved = before.filter((service) => !oldCanonical.has(canonicalComponent(service)));
  const installedLegacy = legacyPackages.filter((legacy) => packageInstalled(options.serial, legacy));
  const settingsBefore = nativeEnglishState(options.serial);
  if (!settingsBefore.pid || !settingsBefore.dashboardService) {
    throw new Error("JMGO Settings process or DashboardService is unavailable; refusing locale repair");
  }

  for (const command of disableOld) run(...command);
  const afterDisable = new Set(enabledServices(options.serial).map(canonicalComponent));
  const stillEnabled = oldServices.filter((service) => afterDisable.has(canonicalComponent(service)));
  if (stillEnabled.length > 0) throw new Error(`Old accessibility service is still enabled: ${stillEnabled.join(", ")}`);
  const removed = preserved.filter((service) => !afterDisable.has(canonicalComponent(service)));
  if (removed.length > 0) throw new Error(`Migration removed an unrelated accessibility service: ${removed.join(", ")}`);

  run(...install);
  run(...grant);
  if (!permissionGranted(options.serial, packageName)) {
    throw new Error(`${CHANGE_CONFIGURATION} was not granted`);
  }

  const repairOutput = run(...repair, true);
  if (!/Broadcast completed:\s+result=-1/u.test(repairOutput)) {
    throw new Error(`Native English repair receiver failed: ${repairOutput.trim() || "no broadcast result"}`);
  }
  const state = waitForNativeEnglish(options.serial);
  if (state.pid !== settingsBefore.pid) {
    throw new Error(`JMGO Settings process restarted during locale repair (${settingsBefore.pid} -> ${state.pid})`);
  }
  if (!state.dashboardService) {
    throw new Error("JMGO DashboardService was not preserved during locale repair");
  }

  const finalServices = new Set(enabledServices(options.serial).map(canonicalComponent));
  const finalRemoved = preserved.filter((service) => !finalServices.has(canonicalComponent(service)));
  if (finalRemoved.length > 0) {
    throw new Error(`Native English activation removed an unrelated accessibility service: ${finalRemoved.join(", ")}`);
  }
  if (oldServices.some((service) => finalServices.has(canonicalComponent(service)))) {
    throw new Error("An old English accessibility service was re-enabled unexpectedly");
  }

  for (const legacy of installedLegacy) run("adb", ["-s", options.serial, "uninstall", legacy]);
  console.log(`JMGO Native English is active (locale=${state.locale}, ${state.config}) with Settings PID ${state.pid}, DashboardService preserved, SettingService restored, and no patch accessibility service.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
