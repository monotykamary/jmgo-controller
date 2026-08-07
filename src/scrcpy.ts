import { Adb } from "./adb.js";
import { findExecutable, runProcess, type ProcessResult } from "./process.js";

export class ScrcpyError extends Error {}

export type ScrcpyOptions = {
  mirror?: boolean;
  extraArgs?: readonly string[];
};

export function buildScrcpyArgs(
  serial: string,
  options: ScrcpyOptions = {},
): string[] {
  const inputArgs = ["--mouse=uhid", "--keyboard=uhid"];
  const displayArgs = options.mirror ? [] : ["--no-video", "--no-audio"];
  return [
    "--serial",
    serial,
    ...displayArgs,
    ...inputArgs,
    ...(options.extraArgs ?? []),
  ];
}

export async function runScrcpy(
  host: string,
  options: ScrcpyOptions = {},
): Promise<ProcessResult> {
  const executable = await findExecutable("scrcpy");
  if (!executable) {
    throw new ScrcpyError("scrcpy was not found; install on macOS with: brew install scrcpy");
  }

  const adb = await Adb.create(host);
  await adb.connect();
  return runProcess(executable, buildScrcpyArgs(adb.serial, options), { inherit: true });
}
