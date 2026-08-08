#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Adb } from "./adb.js";
import {
  ARTEMIS_PACKAGE,
  JMGO_SETTINGS_PACKAGE,
  buildArtemisAppLaunchCommand,
  listMonitors,
  listSunshineApps,
  readSunshineHostName,
  readSunshineMonitor,
  resolveMonitor,
  resolveSunshineApp,
  restartSunshine,
  saveSunshineMinimumFps,
  saveSunshineMonitor,
} from "./artemis.js";
import { clearSavedHost, configPath, loadSavedHost, saveHost } from "./config.js";
import { discover } from "./discovery.js";
import { installFromPlay } from "./play.js";
import { findExecutable, runProcess } from "./process.js";
import { runCompletion } from "./completion.js";
import { completionScriptFor, isSupportedShell, supportedShells } from "./completion-scripts.js";
import { renderHelp, suggest } from "./help.js";
import { keyCodes, Remote, type RemoteKey } from "./remote.js";
import { unwireShellCompletions, wireShellCompletions } from "./shell-completions.js";
import { commandSpec, resolveCommandPath } from "./spec.js";

function usageError(commandPath: string, value: string | undefined, choices: readonly string[]): Error {
  const hint = value !== undefined ? suggest(value, choices) : undefined;
  const where = commandPath === "" ? "jmgo" : `jmgo ${commandPath}`;
  const detail = value === undefined ? `${where} requires a command` : `unknown command for ${where}: ${value}`;
  return new Error(`${detail}${hint ? `. Did you mean "${hint}"?` : ""}\nrun "${where} --help" for usage`);
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

async function hostFrom(args: string[]): Promise<string> {
  const host = takeOption(args, "--host") ?? process.env.JMGO_HOST ?? (await loadSavedHost());
  if (!host) {
    throw new Error(
      "projector host required: run jmgo discover set, pass --host, or set JMGO_HOST",
    );
  }
  return host;
}

async function adbFrom(args: string[]): Promise<Adb> {
  return Adb.create(await hostFrom(args));
}

async function remoteCommand(args: string[]): Promise<void> {
  const host = await hostFrom(args);
  const command = args.shift();
  const remote = new Remote(host);
  if (command === "status") {
    console.log(JSON.stringify(await remote.readState(1_000, takeFlag(args, "--include-identifiers")), null, 2));
  } else if (command === "key") {
    const key = args.shift() as RemoteKey | undefined;
    if (!key || !(key in keyCodes)) {
      throw new Error(
        `${key ? `unknown remote key: ${key}` : "remote key requires a key name"}\nkeys: ${Object.keys(keyCodes).join(", ")}\nrun "jmgo remote key --help" for details`,
      );
    }
    await remote.press(key);
  } else if (command === "volume") {
    const action = args.shift();
    if (!action) console.log((await remote.readState()).volume ?? "unknown");
    else if (action === "up" || action === "down") await remote.press(`volume-${action}`);
    else if (action === "set") await remote.setVolume(Number(args.shift()));
    else {
      throw new Error(
        `unknown volume action: ${action}${suggest(action, ["up", "down", "set"]) ? `. Did you mean "${suggest(action, ["up", "down", "set"])}"?` : ""}\nrun "jmgo remote volume --help" for usage`,
      );
    }
  } else if (command === "watch") {
    const include = takeFlag(args, "--include-identifiers");
    for await (const state of remote.watch(include)) console.log(JSON.stringify(state));
  } else throw usageError("remote", command, ["status", "key", "volume", "watch"]);
}

async function adbCommand(args: string[]): Promise<void> {
  const adb = await adbFrom(args);
  const command = args.shift();
  if (command === "info") console.log(JSON.stringify(await adb.info(), null, 2));
  else if (command === "current") console.log(await adb.currentApp());
  else if (command === "audio") console.log(await adb.audio());
  else if (command === "packages") console.log((await adb.packages(args.shift())).join("\n"));
  else if (command === "install") console.log(await adb.install(args));
  else if (command === "uninstall") {
    const keepData = takeFlag(args, "--keep-data");
    const packageName = args.shift();
    if (!packageName) throw new Error("uninstall requires a package name");
    console.log(await adb.uninstall(packageName, keepData));
  } else if (command === "launch") {
    const packageName = args.shift();
    if (!packageName) throw new Error("launch requires a package name");
    console.log(await adb.launch(packageName));
  } else if (command === "screenshot") {
    const output = args.shift();
    if (!output) throw new Error("screenshot requires an output path");
    console.log(await adb.screenshot(output));
  } else if (command === "input") {
    // adb input keyevent KEYCODE_DPAD_OK | mouse tap 500 500 | keyboard text hello | ...
    const output = await adb.input(args);
    if (output) console.log(output);
  } else throw usageError("adb", command, ["info", "current", "audio", "packages", "install", "uninstall", "launch", "screenshot", "input"]);
}

async function waitForArtemisStream(adb: Adb, appName: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastProbeError: unknown;
  while (Date.now() < deadline) {
    try {
      if ((await adb.currentApp()).includes(`${ARTEMIS_PACKAGE}/com.limelight.Game`)) return;
      lastProbeError = undefined;
    } catch (error) {
      // Immediately after an APK replacement there may briefly be no resumed activity,
      // causing the remote grep to exit 1. Keep polling within the launch deadline.
      lastProbeError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Artemis did not start ${JSON.stringify(appName)} in time; open the host once to refresh its app list or retry without --no-restart`,
    { cause: lastProbeError },
  );
}

async function artemisCommand(args: string[]): Promise<void> {
  const action = args[0] && !args[0].startsWith("--") ? args.shift() : "open";
  if (action === "apps") {
    const json = takeFlag(args, "--json");
    if (args.length > 0) throw new Error(`unknown artemis apps option: ${args[0]}`);
    const apps = await listSunshineApps();
    if (json) console.log(JSON.stringify(apps, null, 2));
    else for (const app of apps) console.log(`${app.index} · ${app.name}`);
    return;
  }
  if (action === "monitors") {
    const json = takeFlag(args, "--json");
    if (args.length > 0) throw new Error(`unknown artemis monitors option: ${args[0]}`);
    const [monitors, configured] = await Promise.all([listMonitors(), readSunshineMonitor()]);
    const output = monitors.map((monitor) => ({
      ...monitor,
      selected: configured ? monitor.id === configured : monitor.primary,
    }));
    if (json) console.log(JSON.stringify(output, null, 2));
    else {
      for (const monitor of output) {
        const resolution = monitor.resolution ? ` · ${monitor.resolution}` : "";
        console.log(`${monitor.selected ? "*" : " "} ${monitor.id} · ${monitor.name}${resolution}`);
      }
    }
    return;
  }
  if (action !== "open") throw usageError("artemis", action, ["open", "apps", "monitors"]);

  const monitorSelector = takeOption(args, "--monitor");
  const minimumFpsOption = takeOption(args, "--minimum-fps");
  const appSelector = takeOption(args, "--app");
  const computerSelector = takeOption(args, "--pc");
  const noRestart = takeFlag(args, "--no-restart");
  const host = await hostFrom(args);
  if (args.length > 0) throw new Error(`unknown artemis option: ${args[0]}`);
  if ((monitorSelector || minimumFpsOption) && noRestart) {
    throw new Error("--monitor and --minimum-fps require Sunshine restart; remove --no-restart");
  }
  const minimumFps = minimumFpsOption === undefined ? undefined : Number(minimumFpsOption);
  if (minimumFps !== undefined && (!Number.isInteger(minimumFps) || minimumFps < 0 || minimumFps > 240)) {
    throw new Error("--minimum-fps must be an integer from 0 through 240");
  }
  if (computerSelector && !appSelector) throw new Error("--pc requires --app");

  const selectedApp = appSelector
    ? resolveSunshineApp(await listSunshineApps(), appSelector)
    : undefined;
  let selectedMonitor: string | undefined;
  if (monitorSelector) {
    const monitor = resolveMonitor(await listMonitors(), monitorSelector);
    await saveSunshineMonitor(monitor.id);
    selectedMonitor = `${monitor.name} (${monitor.id})`;
  }
  if (minimumFps !== undefined) await saveSunshineMinimumFps(minimumFps);
  if (!noRestart) await restartSunshine();

  const adb = await Adb.create(host);
  if (!(await adb.isPackageInstalled(ARTEMIS_PACKAGE))) {
    throw new Error(
      `JMGO Artemis Lab is not installed (${ARTEMIS_PACKAGE}); build and install experiments/artemis-jmgo first`,
    );
  }
  if (await adb.isPackageInstalled(JMGO_SETTINGS_PACKAGE)) {
    await adb.forceStop(JMGO_SETTINGS_PACKAGE);
  }
  await adb.forceStop(ARTEMIS_PACKAGE);
  if (selectedApp) {
    const computerName = computerSelector ?? (await readSunshineHostName());
    try {
      await adb.shell(buildArtemisAppLaunchCommand(selectedApp.name, computerName));
      await waitForArtemisStream(adb, selectedApp.name);
    } catch (error) {
      await adb.forceStop(ARTEMIS_PACKAGE).catch(() => undefined);
      throw error;
    }
    console.log(
      `streaming ${selectedApp.name} through JMGO Artemis Lab${selectedMonitor ? ` on ${selectedMonitor}` : ""}`,
    );
  } else {
    await adb.launch(ARTEMIS_PACKAGE);
    console.log(`opened JMGO Artemis Lab${selectedMonitor ? ` on ${selectedMonitor}` : ""}`);
  }
  if (minimumFps !== undefined) console.log(`Sunshine minimum FPS target set to ${minimumFps}`);
  if (!noRestart) console.log("Sunshine restarted first to clear orphaned sessions");
}

async function playCommand(args: string[]): Promise<void> {
  const command = args.shift();
  const gplaydl = await findExecutable("gplaydl");
  if ((command === "link" || command === "search" || command === "info") && !gplaydl) {
    throw new Error("gplaydl was not found; install with: pipx install gplaydl");
  }
  if (command === "link") await runProcess(gplaydl as string, ["link"], { inherit: true });
  else if (command === "search") {
    const query = args.shift();
    if (!query) throw new Error("search requires a query");
    await runProcess(gplaydl as string, ["search", query, "--limit", takeOption(args, "--limit") ?? "10"], { inherit: true });
  } else if (command === "info") {
    const packageName = args.shift();
    if (!packageName) throw new Error("info requires a package name");
    await runProcess(gplaydl as string, ["info", packageName], { inherit: true });
  } else if (command === "install") {
    const host = await hostFrom(args);
    const packageName = args.shift();
    if (!packageName) throw new Error("install requires a package name");
    const languages = takeOption(args, "--languages");
    const keepDownloads = takeOption(args, "--keep-downloads");
    const result = await installFromPlay(await Adb.create(host), packageName, {
      architecture: takeOption(args, "--arch") ?? "tv",
      ...(languages ? { languages } : {}),
      ...(keepDownloads ? { keepDownloads } : {}),
    });
    console.log(result.output);
    console.log(`signer-sha256: ${result.signerSha256}`);
  } else throw usageError("play", command, ["link", "search", "info", "install"]);
}

async function completionsCommand(args: string[]): Promise<void> {
  const install = takeFlag(args, "--install");
  const uninstall = takeFlag(args, "--uninstall");
  const shell = args.shift();
  if (shell === undefined || !isSupportedShell(shell)) {
    throw new Error(
      `${shell === undefined ? "completions requires a shell name" : `unknown shell: ${shell}`} (supported: ${supportedShells.join(", ")})\nrun "jmgo completions --help" for usage`,
    );
  }
  if (install && uninstall) throw new Error("choose --install or --uninstall, not both");
  if (install) {
    const result = await wireShellCompletions(shell);
    if (result.method === "drop-dir") {
      console.log(`installed ${shell} completions to ${result.path}`);
      console.log("start a new shell; it loads them automatically");
    } else {
      console.log(`wired ${shell} completions into ${result.path}`);
      console.log("start a new shell, or source that file");
    }
    return;
  }
  if (uninstall) {
    const result = await unwireShellCompletions(shell);
    if (result.rcRemoved || result.dropRemoved) console.log(`removed ${shell} completions`);
    else console.log(`${shell} completions were not installed`);
    return;
  }
  process.stdout.write(completionScriptFor(shell));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (takeFlag(args, "--version")) {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    console.log(packageJson.version);
    return;
  }
  // Help is progressive: --help resolves against the already-typed command
  // path, so "jmgo remote --help" shows remote help and "jmgo remote key
  // --help" shows the key list.
  const helpScan = args;
  if (args.length === 0) {
    process.stdout.write(renderHelp());
    return;
  }
  if (helpScan.includes("--help") || helpScan.includes("-h")) {
    takeFlag(args, "--help");
    takeFlag(args, "-h");
    process.stdout.write(renderHelp(resolveCommandPath(args).path));
    return;
  }
  const command = args.shift() as string;
  if (command === "_completion") {
    const words = args[0] === "--" ? args.slice(1) : args;
    process.stdout.write(runCompletion(words));
    return;
  }
  if (command === "completions") {
    await completionsCommand(args);
    return;
  }
  if (command === "discover") {
    const shouldSave = args[0] === "set";
    if (shouldSave) args.shift();
    const network = takeOption(args, "--network");
    const timeout = Number(takeOption(args, "--timeout") ?? 200);
    const hosts = await discover(network, timeout);
    if (!shouldSave) console.log(hosts.join("\n"));
    else if (hosts.length === 0) throw new Error("no JMGO projector found");
    else if (hosts.length > 1) {
      throw new Error(`multiple projectors found (${hosts.join(", ")}); use jmgo host set IP`);
    } else {
      await saveHost(hosts[0] as string);
      console.log(`saved ${hosts[0]} to ${configPath()}`);
    }
  } else if (command === "host") {
    const action = args.shift();
    if (action === "show") console.log((await loadSavedHost()) ?? "not set");
    else if (action === "set") {
      const host = args.shift();
      if (!host) throw new Error("host set requires an IP address or hostname");
      await saveHost(host);
      console.log(`saved ${host} to ${configPath()}`);
    } else if (action === "clear") {
      await clearSavedHost();
      console.log(`cleared ${configPath()}`);
    } else throw usageError("host", action, ["show", "set", "clear"]);
  } else if (command === "remote") await remoteCommand(args);
  else if (command === "adb") await adbCommand(args);
  else if (command === "artemis") await artemisCommand(args);
  else if (command === "play") await playCommand(args);
  else if (command === "doctor") {
    const report = {
      host:
        takeOption(args, "--host") ?? process.env.JMGO_HOST ?? (await loadSavedHost()) ?? null,
      adb: await findExecutable("adb"),
      apksigner: await findExecutable("apksigner"),
      gplaydl: await findExecutable("gplaydl"),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.host || !report.adb || !report.apksigner || !report.gplaydl) {
      process.exitCode = 1;
    }
  } else {
    throw usageError(
      "",
      command,
      commandSpec.subcommands.map((child) => child.name),
    );
  }
}

main().catch((error: unknown) => {
  console.error(`jmgo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
