import { keyCodes, type RemoteKey } from "./remote.js";
import { commandSpec, programName, type CommandSpec, type OptionSpec, type PositionalSpec } from "./spec.js";

const indent = "  ";

function usageFor(path: readonly string[], node: CommandSpec): string {
  const parts = [programName, ...path];
  if (node.subcommands.length > 0) {
    parts.push("<command>");
  } else {
    if (node.options.length > 0) parts.push("[options]");
    for (const positional of node.positionals) {
      const inner = `${positional.name}${positional.variadic ? "..." : ""}`;
      parts.push(positional.optional ? `[${inner}]` : `<${inner}>`);
    }
  }
  return parts.join(" ");
}

function optionLabel(option: OptionSpec): string {
  const value = option.valueName !== undefined ? ` ${option.valueName}` : "";
  return option.short !== undefined ? `${option.short}, ${option.long}${value}` : `${option.long}${value}`;
}

function renderTable(rows: readonly [string, string][]): string[] {
  if (rows.length === 0) return [];
  const width = Math.min(
    Math.max(...rows.map(([label]) => label.length)),
    32,
  );
  return rows.map(
    ([label, description]) => `${indent}${label.padEnd(width)}  ${description}`,
  );
}

function positionalLabel(positional: PositionalSpec): string {
  const inner = `${positional.name}${positional.variadic ? "..." : ""}`;
  return positional.optional ? `[${inner}]` : `<${inner}>`;
}

// Remote keys get a grouped table annotated with the Android key codes from
// remote.ts, so `jmgo remote key --help` doubles as a key-code reference.
function renderGroupedValues(positional: PositionalSpec): string[] {
  const lines: string[] = [];
  const groups = positional.groups ?? [];
  const annotate = (value: string): string =>
    value in keyCodes ? `${value} (${keyCodes[value as RemoteKey]})` : value;
  if (groups.length > 0) {
    const width = Math.max(...groups.map((group) => group.title.length));
    for (const group of groups) {
      lines.push(`${indent}${group.title.padEnd(width)}  ${group.values.map(annotate).join(" · ")}`);
    }
    return lines;
  }
  if (positional.values !== undefined) {
    lines.push(`${indent}${positional.values.join(", ")}`);
  }
  return lines;
}

// Render the help page for the command at `path` (empty = the program root).
// Heading, optional prose, usage line, grouped positional values (remote keys),
// a Commands table, an Options table, and an optional footer note.
export function renderHelp(path: readonly string[] = []): string {
  let node = commandSpec;
  for (const step of path) {
    const child = node.subcommands.find((candidate) => candidate.name === step);
    if (!child) throw new Error(`unknown help path: ${path.join(" ")}`);
    node = child;
  }

  const heading = path.length === 0 ? programName : `${programName} ${path.join(" ")}`;
  const sections: string[] = [`${heading} — ${node.summary}`];
  if (node.description !== undefined) sections.push(node.description);

  sections.push(`Usage:\n${indent}${usageFor(path, node)}`);

  const positionalsWithValues = node.positionals.filter(
    (positional) => positional.values !== undefined,
  );
  if (positionalsWithValues.length > 0) {
    const lines: string[] = [];
    for (const positional of positionalsWithValues) {
      lines.push(`${positionalLabel(positional)} — one of:`);
      lines.push(...renderGroupedValues(positional));
    }
    sections.push(lines.join("\n"));
  }

  if (node.subcommands.length > 0) {
    const rows = node.subcommands.map(
      (child): [string, string] => [child.name, child.summary],
    );
    sections.push(`Commands:\n${renderTable(rows).join("\n")}`);
  }

  if (node.options.length > 0) {
    const rows = node.options.map(
      (option): [string, string] => [optionLabel(option), option.description],
    );
    sections.push(`Options:\n${renderTable(rows).join("\n")}`);
  }

  if (node.footer !== undefined) sections.push(node.footer);
  return `${sections.join("\n\n")}\n`;
}

// Levenshtein-based "did you mean" for mistyped commands, in the style of
// commander's suggestions. Returns undefined when nothing is close enough.
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.startsWith(input) || input.startsWith(candidate)) return candidate;
    const distance = editDistance(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  const tolerance = Math.max(2, Math.floor(input.length / 3));
  return best !== undefined && bestDistance <= tolerance ? best : undefined;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let upperLeft = previous[0] as number;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] as number;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min((previous[j] as number) + 1, (previous[j - 1] as number) + 1, upperLeft + cost);
      upperLeft = above;
    }
  }
  return previous[b.length] as number;
}
