#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Adb } from "./adb.js";
import {
  ARTEMIS_PACKAGE,
  listMonitors,
  readSunshineMonitor,
  resolveMonitor,
  restartSunshine,
  saveSunshineMonitor,
} from "./artemis.js";
import { clearSavedHost, configPath, loadSavedHost, saveHost } from "./config.js";
import { discover } from "./discovery.js";
import { installFromPlay } from "./play.js";
import { findExecutable, runProcess } from "./process.js";
import { keyCodes, Remote, type RemoteKey } from "./remote.js";
import { runScrcpy } from "./scrcpy.js";

const help = `jmgo-controller

Usage:
  jmgo discover [set] [--network CIDR] [--timeout MS]
  jmgo host <show|set IP|clear>
  jmgo remote [--host IP] status [--include-identifiers]
  jmgo remote [--host IP] volume [up|down|set LEVEL]
  jmgo remote [--host IP] key <${Object.keys(keyCodes).join("|")}>
  jmgo remote [--host IP] watch [--include-identifiers]
  jmgo adb [--host IP] <info|current|audio|packages|install|uninstall|launch|screenshot>
  jmgo scrcpy [--host IP] [--mirror] [-- SCRCPY_ARGS...]
  jmgo artemis [open] [--host IP] [--monitor ID|NAME|primary] [--no-restart]
  jmgo artemis monitors [--json]
  jmgo play <link|search|info>
  jmgo play [--host IP] install PACKAGE [--arch tv] [--languages LIST]
  jmgo doctor [--host IP]

Set JMGO_HOST to avoid passing --host repeatedly.`;

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
    if (!key || !(key in keyCodes)) throw new Error("a valid remote key is required");
    await remote.press(key);
  } else if (command === "volume") {
    const action = args.shift();
    if (!action) console.log((await remote.readState()).volume ?? "unknown");
    else if (action === "up" || action === "down") await remote.press(`volume-${action}`);
    else if (action === "set") await remote.setVolume(Number(args.shift()));
    else throw new Error(`unknown volume action: ${action}`);
  } else if (command === "watch") {
    const include = takeFlag(args, "--include-identifiers");
    for await (const state of remote.watch(include)) console.log(JSON.stringify(state));
  } else {
    throw new Error("remote command must be status, key, volume, or watch");
  }
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
  } else throw new Error("unknown adb command");
}

async function scrcpyCommand(args: string[]): Promise<void> {
  const host = await hostFrom(args);
  const mirror = takeFlag(args, "--mirror");
  const separator = args.indexOf("--");
  if (separator >= 0) args.splice(separator, 1);
  await runScrcpy(host, { mirror, extraArgs: args });
}

async function artemisCommand(args: string[]): Promise<void> {
  const action = args[0] && !args[0].startsWith("--") ? args.shift() : "open";
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
  if (action !== "open") throw new Error("artemis command must be open or monitors");

  const monitorSelector = takeOption(args, "--monitor");
  const noRestart = takeFlag(args, "--no-restart");
  const host = await hostFrom(args);
  if (args.length > 0) throw new Error(`unknown artemis option: ${args[0]}`);
  if (monitorSelector && noRestart) {
    throw new Error("--monitor requires Sunshine restart; remove --no-restart");
  }

  let selectedMonitor: string | undefined;
  if (monitorSelector) {
    const monitor = resolveMonitor(await listMonitors(), monitorSelector);
    await saveSunshineMonitor(monitor.id);
    selectedMonitor = `${monitor.name} (${monitor.id})`;
  }
  if (!noRestart) await restartSunshine();

  const adb = await Adb.create(host);
  if (!(await adb.isPackageInstalled(ARTEMIS_PACKAGE))) {
    throw new Error(
      `JMGO Artemis Lab is not installed (${ARTEMIS_PACKAGE}); build and install experiments/artemis-jmgo first`,
    );
  }
  await adb.forceStop(ARTEMIS_PACKAGE);
  await adb.launch(ARTEMIS_PACKAGE);
  console.log(`opened JMGO Artemis Lab${selectedMonitor ? ` on ${selectedMonitor}` : ""}`);
  if (!noRestart) console.log("Sunshine restarted first to clear orphaned Desktop sessions");
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
  } else throw new Error("play command must be link, search, info, or install");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (takeFlag(args, "--version")) {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    console.log(packageJson.version);
    return;
  }
  if (args.length === 0 || takeFlag(args, "--help") || takeFlag(args, "-h")) {
    console.log(help);
    return;
  }
  const command = args.shift();
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
    } else throw new Error("host command must be show, set, or clear");
  } else if (command === "remote") await remoteCommand(args);
  else if (command === "adb") await adbCommand(args);
  else if (command === "scrcpy") await scrcpyCommand(args);
  else if (command === "artemis") await artemisCommand(args);
  else if (command === "play") await playCommand(args);
  else if (command === "doctor") {
    const report = {
      host:
        takeOption(args, "--host") ?? process.env.JMGO_HOST ?? (await loadSavedHost()) ?? null,
      adb: await findExecutable("adb"),
      scrcpy: await findExecutable("scrcpy"),
      apksigner: await findExecutable("apksigner"),
      gplaydl: await findExecutable("gplaydl"),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.host || !report.adb || !report.scrcpy || !report.apksigner || !report.gplaydl) {
      process.exitCode = 1;
    }
  } else throw new Error(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(`jmgo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
