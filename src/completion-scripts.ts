import { programName } from "./spec.js";

// Shell completion scripts emitted by `jmgo completions <shell>`. There is no
// daemon fast path here (that was a localterm concern): every <Tab> shells
// out to `jmgo _completion`, which walks the spec tree. Candidates are
// newline-separated single tokens; subcommands, flags, and enum values never
// contain spaces.

// bash: `complete -o default -F` registers the handler; an empty COMPREPLY
// falls back to readline filename completion for path-valued positionals
// (adb install, screenshot). Classic compgen+$() form, not
// mapfile, for macOS bash 3.2. Serves the eval script and the drop-file.
export const buildBashCompletionScript = (): string =>
  [
    `_${programName}_completion() {`,
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    "  local candidates",
    `  candidates=$(${programName} _completion -- "\${COMP_WORDS[@]}" 2>/dev/null)`,
    '  if [[ -n $candidates ]]; then',
    '    COMPREPLY=($(compgen -W "$candidates" -- "$cur"))',
    "  fi",
    "  return 0",
    "}",
    `complete -o default -F _${programName}_completion ${programName}`,
    "",
  ].join("\n");

// zsh (eval/source form): compadd the newline-split candidates, or _files
// when empty. compdef is guarded so sourcing before compinit is a no-op.
export const buildZshCompletionScript = (): string =>
  [
    `#compdef ${programName}`,
    `_${programName}() {`,
    "  local candidates",
    `  candidates=$(${programName} _completion -- "\${words[@]}" 2>/dev/null)`,
    '  if [[ -n $candidates ]]; then',
    "    compadd -- ${(f)candidates}",
    "  else",
    "    _files",
    "  fi",
    "  return 0",
    "}",
    "if command -v compdef >/dev/null 2>&1; then",
    `  compdef _${programName} ${programName}`,
    "fi",
    "",
  ].join("\n");

// zsh (fpath drop-file form): the file IS the completion function body — no
// wrapper, no compdef. The leading #compdef line makes zsh autoload this file
// for `jmgo` when it sits on an fpath directory and compinit has run.
export const buildZshCompletionFile = (): string =>
  [
    `#compdef ${programName}`,
    "local candidates",
    `candidates=$(${programName} _completion -- "\${words[@]}" 2>/dev/null)`,
    'if [[ -n $candidates ]]; then',
    "  compadd -- ${(f)candidates}",
    "else",
    "  _files",
    "fi",
    "return 0",
    "",
  ].join("\n");

// fish: the function prints CLI candidates, or __fish_complete_path output
// when the CLI had nothing (APK paths, screenshot output).
// `complete -f` makes this function the sole source of candidates.
export const buildFishCompletionScript = (): string =>
  [
    `function __${programName}_complete`,
    "  set -l words (commandline -opc) (commandline -ct)",
    `  set -l candidates (${programName} _completion -- $words 2>/dev/null)`,
    "  if test (count $candidates) -gt 0",
    "    printf '%s\\n' $candidates",
    "  else",
    "    __fish_complete_path (commandline -ct)",
    "  end",
    "end",
    `complete -c ${programName} -a "(__${programName}_complete)" -f`,
    "",
  ].join("\n");

// What `jmgo completions <shell>` prints to stdout (for eval/source).
export const completionScriptFor = (shell: string): string => {
  switch (shell) {
    case "bash":
      return buildBashCompletionScript();
    case "zsh":
      return buildZshCompletionScript();
    case "fish":
      return buildFishCompletionScript();
    default:
      return "";
  }
};

// The file content written to a shell's auto-loaded completion directory.
// bash/fish reuse their source script; zsh needs the fpath body form.
export const completionFileFor = (shell: string): string => {
  switch (shell) {
    case "bash":
      return buildBashCompletionScript();
    case "zsh":
      return buildZshCompletionFile();
    case "fish":
      return buildFishCompletionScript();
    default:
      return "";
  }
};

export const supportedShells = ["bash", "zsh", "fish"] as const;
export const isSupportedShell = (shell: string): boolean =>
  (supportedShells as readonly string[]).includes(shell);
