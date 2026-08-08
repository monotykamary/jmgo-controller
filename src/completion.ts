import { commandSpec, type CommandSpec, type OptionSpec } from "./spec.js";

// Shell completion over the plain-data command tree (src/spec.ts), modeled on
// the localterm walker/resolver pair: walk the already-typed tokens to the
// deepest command, then pick candidates from context — option values, option
// flags, subcommand names, or static positional values. Anything else yields
// no candidates, and the shell scripts fall back to filename completion.

export interface CompletionContext {
  command: CommandSpec;
  positionalIndex: number;
  currentWord: string;
  completingOptionValue: OptionSpec | null;
}

const splitFlag = (token: string): [string, string | undefined] => {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex === -1) return [token, undefined];
  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
};

const findOption = (node: CommandSpec, flag: string): OptionSpec | null => {
  for (const option of node.options) {
    if (option.long === flag || option.short === flag) return option;
  }
  return null;
};

// `words` is the full command line the shell passed: words[0] is the program
// name, the last element is the partial current word (possibly ""), and in
// between are the previously typed tokens. Options that take a value skip
// their following token; subcommands descend and reset the positional count;
// a passthrough command stops the walk entirely — its arguments are
// another program's, so completion defers to filenames.
export const resolveCompletionContext = (words: readonly string[]): CompletionContext => {
  const previousTokens = words.slice(1, -1);
  const currentWord = words[words.length - 1] ?? "";

  let current = commandSpec;
  let positionalIndex = 0;
  let expectingOptionValue: OptionSpec | null = null;

  for (const token of previousTokens) {
    if (token === "--") continue;
    if (expectingOptionValue) {
      expectingOptionValue = null;
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      const [flag, inlineValue] = splitFlag(token);
      const option = findOption(current, flag);
      if (option?.valueName !== undefined && inlineValue === undefined) {
        expectingOptionValue = option;
      }
      continue;
    }
    const subcommand = current.subcommands.find((child) => child.name === token);
    if (subcommand) {
      current = subcommand;
      positionalIndex = 0;
      if (current.passthrough) break;
      continue;
    }
    positionalIndex += 1;
  }

  if (currentWord.startsWith("-")) {
    return { command: current, positionalIndex, currentWord, completingOptionValue: null };
  }
  return { command: current, positionalIndex, currentWord, completingOptionValue: expectingOptionValue };
};

const optionFlags = (node: CommandSpec): string[] => {
  const flags: string[] = [];
  for (const option of node.options) {
    flags.push(option.long);
    if (option.short !== undefined) flags.push(option.short);
  }
  return flags;
};

export const resolveCandidates = (context: CompletionContext): string[] => {
  const { command, positionalIndex, currentWord, completingOptionValue } = context;

  if (completingOptionValue) return [...(completingOptionValue.argChoices ?? [])];
  if (currentWord.startsWith("-")) return optionFlags(command);
  if (command.subcommands.length > 0 && positionalIndex === 0) {
    return command.subcommands.map((child) => child.name);
  }
  const last = command.positionals[command.positionals.length - 1];
  const positional = command.positionals[positionalIndex] ?? (last?.variadic === true ? last : undefined);
  if (!positional || positional.source === "files") return [];
  return [...(positional.values ?? [])];
};

// Filter by the typed prefix, dedupe, sort, one candidate per line — what the
// generated bash/zsh/fish scripts and `_completion` both emit on stdout.
export const formatCandidates = (candidates: readonly string[], prefix: string): string => {
  const matches =
    prefix === "" ? candidates : candidates.filter((candidate) => candidate.startsWith(prefix));
  return [...new Set(matches)]
    .sort()
    .map((candidate) => `${candidate}\n`)
    .join("");
};

// The hidden `jmgo _completion` entrypoint. Completion fires on every <Tab>,
// so it never throws and never writes to stderr: any failure renders as no
// candidates and the shell falls back to filename completion.
export const runCompletion = (words: readonly string[]): string => {
  try {
    const context = resolveCompletionContext(words);
    return formatCandidates(resolveCandidates(context), context.currentWord);
  } catch {
    return "";
  }
};
