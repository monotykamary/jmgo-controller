import { Adb } from "./adb.js";
import { findExecutable, runProcess, type ProcessResult } from "./process.js";

export class ScrcpyError extends Error {}

export type ScrcpyOptions = {
  // Mirroring is on by default: remote view plus keyboard and mouse control.
  mirror?: boolean;
  // Mirrored display frame rate cap (default 60).
  maxFps?: number;
  extraArgs?: readonly string[];
};

export function buildScrcpyArgs(
  serial: string,
  options: ScrcpyOptions = {},
): string[] {
  // Mute projector audio by default so it stays on the projector speakers;
  // the S901 also ships no Opus encoder, so scrcpy's default audio stream
  // fails to initialize and kills the session. An --audio* extra flag opts in.
  const audioRequested = (options.extraArgs ?? []).some((arg) => arg.startsWith("--audio"));
  const displayArgs =
    options.mirror === false
      ? ["--no-video", "--no-audio"]
      : [
        `--max-fps=${options.maxFps ?? 60}`,
        "--stay-awake",
        ...(audioRequested ? [] : ["--no-audio"]),
      ];
  return [
    "--serial",
    serial,
    ...displayArgs,
    // Default "sdk" mode injects events through the Android InputManager over
    // ADB shell, the same path "jmgo adb input" uses; UHID never captured
    // focus on macOS. (scrcpy 4.x has no "injection" mode name.)
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
