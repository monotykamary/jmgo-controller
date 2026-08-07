#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Adb } from "./adb.js";
import { discover } from "./discovery.js";
import { installFromPlay } from "./play.js";
import { findExecutable, runProcess } from "./process.js";
import { keyCodes, Remote, type RemoteKey } from "./remote.js";

const help = `jmgo-controller

Usage:
  jmgo discover [--network CIDR] [--timeout MS]
  jmgo remote [--host IP] status [--include-identifiers]
  jmgo remote [--host IP] volume [up|down|set LEVEL]
  jmgo remote [--host IP] key <${Object.keys(keyCodes).join("|")}>
  jmgo remote [--host IP] watch [--include-identifiers]
  jmgo adb [--host IP] <info|current|audio|packages|install|uninstall|launch|screenshot>
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

function hostFrom(args: string[]): string {
  const host = takeOption(args, "--host") ?? process.env.JMGO_HOST;
  if (!host) throw new Error("projector host required: pass --host or set JMGO_HOST");
  return host;
}

async function adbFrom(args: string[]): Promise<Adb> {
  return Adb.create(hostFrom(args));
}

async function remoteCommand(args: string[]): Promise<void> {
  const host = hostFrom(args);
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
    const host = hostFrom(args);
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
    const network = takeOption(args, "--network");
    const timeout = Number(takeOption(args, "--timeout") ?? 200);
    console.log((await discover(network, timeout)).join("\n"));
  } else if (command === "remote") await remoteCommand(args);
  else if (command === "adb") await adbCommand(args);
  else if (command === "play") await playCommand(args);
  else if (command === "doctor") {
    const report = {
      host: takeOption(args, "--host") ?? process.env.JMGO_HOST ?? null,
      adb: await findExecutable("adb"),
      apksigner: await findExecutable("apksigner"),
      gplaydl: await findExecutable("gplaydl"),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.host || !report.adb || !report.apksigner || !report.gplaydl) process.exitCode = 1;
  } else throw new Error(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(`jmgo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
