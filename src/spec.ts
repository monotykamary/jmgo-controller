import { keyCodes, type RemoteKey } from "./remote.js";

// Plain-data mirror of the jmgo command tree. This is the single source of
// truth for progressive help (src/help.ts) and shell completion
// (src/completion.ts): every subcommand, option, and positional both surfaces
// walk. Keep it in sync with the dispatch in src/cli.ts — tests/spec.test.ts
// guards the parts that can drift (remote keys, root commands).

export interface OptionSpec {
  long: string;
  short?: string;
  // Presence means the option consumes the following token as its value.
  valueName?: string;
  argChoices?: readonly string[];
  description: string;
}

export interface PositionalGroup {
  title: string;
  values: readonly string[];
}

export interface PositionalSpec {
  name: string;
  optional?: boolean;
  variadic?: boolean;
  // Static completion candidates (remote keys, shell names, ...).
  values?: readonly string[];
  // Help-only grouped rendering of `values` (used for the remote key list).
  groups?: readonly PositionalGroup[];
  // "files" means the value is a path: no candidates; the shell falls back to
  // its own filename completion.
  source?: "files";
}

export interface CommandSpec {
  name: string;
  summary: string;
  description?: string;
  options: readonly OptionSpec[];
  positionals: readonly PositionalSpec[];
  subcommands: readonly CommandSpec[];
  // Everything after the command is handed to another program.
  passthrough?: boolean;
  footer?: string;
}

export const programName = "jmgo";

const hostOption: OptionSpec = {
  long: "--host",
  valueName: "IP",
  description: "projector IP or hostname (else JMGO_HOST or the saved host)",
};

const identifiersOption: OptionSpec = {
  long: "--include-identifiers",
  description: "include redacted serial and Bluetooth identifiers",
};

const remoteKeyValues = Object.keys(keyCodes) as RemoteKey[];

const remoteKeyGroups: readonly PositionalGroup[] = [
  { title: "navigation", values: ["up", "down", "left", "right", "ok"] },
  { title: "menus", values: ["back", "menu", "home", "settings"] },
  { title: "volume", values: ["volume-up", "volume-down"] },
  { title: "power", values: ["power", "power-menu"] },
];

const artemisOpenOptions: readonly OptionSpec[] = [
  hostOption,
  {
    long: "--monitor",
    valueName: "ID|NAME|primary",
    description: "stream this Sunshine monitor (persisted in sunshine.conf)",
  },
  {
    long: "--minimum-fps",
    valueName: "FPS",
    description: "persist Sunshine's minimum FPS target (0-240)",
  },
  {
    long: "--app",
    valueName: "INDEX|NAME",
    description: "launch straight into this Sunshine app and wait for the stream",
  },
  { long: "--pc", valueName: "NAME", description: "Sunshine host name to pair with --app" },
  {
    long: "--no-restart",
    description: "skip the Sunshine restart that clears orphaned sessions",
  },
];

const jsonOption: OptionSpec = { long: "--json", description: "emit machine-readable JSON" };

// The root node is unnamed: the completion walker skips words[0] (the program
// name) and help renders it as "jmgo". _completion stays out of the tree —
// internal commands are neither completed nor documented.
export const commandSpec: CommandSpec = {
  name: "",
  summary: "Local-first control for JMGO projectors",
  description:
    "Native LAN remote control, ADB automation and input control, certified Artemis streaming, and verified Google Play installs for JMGO projectors running Bonfire OS.",
  options: [
    { long: "--help", short: "-h", description: "show help for jmgo or a command" },
    { long: "--version", description: "print the version" },
  ],
  positionals: [],
  footer: 'Set JMGO_HOST to avoid passing --host repeatedly. Run "jmgo <command> --help" for command-specific usage.',
  subcommands: [
    {
      name: "discover",
      summary: "find JMGO projectors on the local network",
      options: [
        { long: "--network", valueName: "CIDR", description: "subnet to probe (default: the /24 of each local interface)" },
        { long: "--timeout", valueName: "MS", description: "probe timeout in milliseconds (default 200)" },
      ],
      positionals: [],
      subcommands: [
        {
          name: "set",
          summary: "probe, then save the projector when exactly one is found",
          options: [
            { long: "--network", valueName: "CIDR", description: "subnet to probe (default: the /24 of each local interface)" },
            { long: "--timeout", valueName: "MS", description: "probe timeout in milliseconds (default 200)" },
          ],
          positionals: [],
          subcommands: [],
        },
      ],
    },
    {
      name: "host",
      summary: "manage the saved projector host",
      options: [],
      positionals: [],
      subcommands: [
        { name: "show", summary: "print the saved host (or \"not set\")", options: [], positionals: [], subcommands: [] },
        {
          name: "set",
          summary: "save a projector IP or hostname",
          options: [],
          positionals: [{ name: "HOST" }],
          subcommands: [],
        },
        { name: "clear", summary: "remove the saved host", options: [], positionals: [], subcommands: [] },
      ],
    },
    {
      name: "remote",
      summary: "infrared-style remote control over TCP 9005",
      options: [hostOption],
      positionals: [],
      subcommands: [
        {
          name: "status",
          summary: "read projector state once, as JSON",
          options: [hostOption, identifiersOption],
          positionals: [],
          subcommands: [],
        },
        {
          name: "key",
          summary: "press a single remote key",
          description: "Keys are Android key codes understood by Bonfire OS on the JMGO S901; other models may differ.",
          options: [hostOption],
          positionals: [
            { name: "KEY", values: remoteKeyValues, groups: remoteKeyGroups },
          ],
          subcommands: [],
        },
        {
          name: "volume",
          summary: "read the volume, or nudge, or set it",
          options: [hostOption],
          positionals: [
            { name: "ACTION", optional: true, values: ["up", "down", "set"] },
            { name: "LEVEL", optional: true },
          ],
          subcommands: [],
        },
        {
          name: "watch",
          summary: "stream projector state changes, one JSON object per line",
          options: [hostOption, identifiersOption],
          positionals: [],
          subcommands: [],
        },
      ],
    },
    {
      name: "adb",
      summary: "ADB automation: inspect, install, and launch apps",
      options: [hostOption],
      positionals: [],
      subcommands: [
        { name: "info", summary: "device model, Android version, and firmware, as JSON", options: [hostOption], positionals: [], subcommands: [] },
        { name: "current", summary: "print the foreground app component", options: [hostOption], positionals: [], subcommands: [] },
        { name: "audio", summary: "print the active audio output", options: [hostOption], positionals: [], subcommands: [] },
        {
          name: "packages",
          summary: "list installed packages",
          options: [hostOption],
          positionals: [{ name: "FILTER", optional: true }],
          subcommands: [],
        },
        {
          name: "install",
          summary: "install an APK or a split-APK set in one session",
          options: [hostOption],
          positionals: [{ name: "APK", variadic: true, source: "files" }],
          subcommands: [],
        },
        {
          name: "uninstall",
          summary: "uninstall a package",
          options: [hostOption, { long: "--keep-data", description: "keep the app data and cache directories" }],
          positionals: [{ name: "PACKAGE" }],
          subcommands: [],
        },
        {
          name: "launch",
          summary: "launch a package's main activity",
          options: [hostOption],
          positionals: [{ name: "PACKAGE" }],
          subcommands: [],
        },
        {
          name: "screenshot",
          summary: "capture the display to a local file",
          options: [hostOption],
          positionals: [{ name: "PATH", source: "files" }],
          subcommands: [],
        },
        {
          name: "input",
          summary: "send a keyboard, mouse, or touch event via adb shell input",
          description:
            "Events follow the on-device input tool: <source> <command> <arg>.... Examples: input keyevent KEYCODE_DPAD_OK, input keyevent 4, input mouse tap 500 500, input keyboard text hello, input touchscreen swipe 100 800 100 100 300, input motionevent DOWN 500 500.",
          options: [hostOption],
          positionals: [{ name: "EVENT", variadic: true }],
          subcommands: [],
        },
      ],
    },
    {
      name: "artemis",
      summary: "open JMGO Artemis Lab, optionally straight into a Sunshine stream",
      description: "Defaults to open. --monitor and --minimum-fps are persisted into sunshine.conf and require a Sunshine restart.",
      options: artemisOpenOptions,
      positionals: [],
      subcommands: [
        {
          name: "open",
          summary: "open Artemis (the default action)",
          options: artemisOpenOptions,
          positionals: [],
          subcommands: [],
        },
        {
          name: "apps",
          summary: "list Sunshine apps configured on this Mac",
          options: [jsonOption],
          positionals: [],
          subcommands: [],
        },
        {
          name: "monitors",
          summary: "list Sunshine monitors, marking the selected one",
          options: [jsonOption],
          positionals: [],
          subcommands: [],
        },
      ],
    },
    {
      name: "play",
      summary: "verified Google Play delivery via gplaydl",
      description: "Play authentication belongs entirely to gplaydl; jmgo never sees Google credentials. Every installed split is signature-verified with apksigner.",
      options: [],
      positionals: [],
      subcommands: [
        { name: "link", summary: "authenticate gplaydl with a Google account", options: [], positionals: [], subcommands: [] },
        {
          name: "search",
          summary: "search the Play store",
          options: [{ long: "--limit", valueName: "N", description: "maximum results (default 10)" }],
          positionals: [{ name: "QUERY" }],
          subcommands: [],
        },
        {
          name: "info",
          summary: "show Play metadata for a package",
          options: [],
          positionals: [{ name: "PACKAGE" }],
          subcommands: [],
        },
        {
          name: "install",
          summary: "download, signature-verify, and install a package",
          options: [
            hostOption,
            { long: "--arch", valueName: "ARCH", description: "APK architecture variant (default tv)" },
            { long: "--languages", valueName: "LIST", description: "comma-separated language splits to keep" },
            { long: "--keep-downloads", valueName: "DIR", description: "keep the downloaded APKs in DIR" },
          ],
          positionals: [{ name: "PACKAGE" }],
          subcommands: [],
        },
      ],
    },
    {
      name: "doctor",
      summary: "report host resolution and required executables",
      description: "Exits non-zero when the host is unresolved or adb, apksigner, or gplaydl is missing.",
      options: [hostOption],
      positionals: [],
      subcommands: [],
    },
    {
      name: "completions",
      summary: "print a shell completion script, or wire it into your shell",
      description: "With no flag, prints the script to stdout (eval/source it). --install prefers the shell's auto-loaded completion directory and falls back to a guarded rc-file block; --uninstall removes both.",
      options: [
        { long: "--install", description: "wire completion into your shell" },
        { long: "--uninstall", description: "remove a previously wired completion" },
      ],
      positionals: [{ name: "SHELL", values: ["bash", "zsh", "fish"] }],
      subcommands: [],
    },
  ],
};

export function findSubcommand(node: CommandSpec, name: string): CommandSpec | undefined {
  return node.subcommands.find((child) => child.name === name);
}

// Walk tokens (without the program name) to the deepest matching command node.
// Options declared on the current node consume their values; unrecognized
// tokens are positionals and stop descent. Used identically by --help
// resolution and by error hints, so both point at the same help page.
export function resolveCommandPath(args: readonly string[]): { path: string[]; node: CommandSpec } {
  let node = commandSpec;
  const path: string[] = [];
  let consumingValue = false;
  for (const token of args) {
    if (consumingValue) {
      consumingValue = false;
      continue;
    }
    if (token === "--") continue;
    if (token.startsWith("-") && token !== "-") {
      const flag = token.slice(0, token.indexOf("=") === -1 ? undefined : token.indexOf("="));
      const option = node.options.find((candidate) => candidate.long === flag || candidate.short === flag);
      if (option?.valueName !== undefined && !token.includes("=")) consumingValue = true;
      continue;
    }
    const child = findSubcommand(node, token);
    if (!child) break;
    path.push(child.name);
    node = child;
    if (node.passthrough) break;
  }
  return { path, node };
}
