#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const metadata = JSON.parse(readFileSync(join(ROOT, "catalogs", "targets.json"), "utf8"));
  const files = ["jmgo-english-accessibility.apk"];
  for (const file of files) {
    if (!existsSync(join(options.artifacts, file))) throw new Error(`Missing artifact: ${file}`);
  }

  const commands = files.map((file) => ["adb", ["-s", options.serial, "install", "-r", join(options.artifacts, file)]]);
  commands.push(["adb", ["-s", options.serial, "shell", "am", "start", "-a", "android.settings.ACCESSIBILITY_SETTINGS"]]);

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to modify the projector:\n");
    for (const [command, args] of commands) console.log(commandLine(command, args));
    console.log("\nRollback:");
    console.log(commandLine("adb", ["-s", options.serial, "uninstall", metadata.companionPackage]));
    return;
  }

  for (const [command, args] of commands) {
    console.log(`> ${commandLine(command, args)}`);
    execFileSync(command, args, { stdio: "inherit" });
  }
  console.log("Enable ‘JMGO English Patch’ in Accessibility settings to activate translations.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
