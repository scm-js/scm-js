/**
 * `scmjs completion bash|zsh|fish`: a completion script for the shell, generated from the command tree itself, so
 * every noun, verb and option is in it without a list to keep. An option's value completes from its choices (or as a
 * file when it names one), an argument from its choices, else as a file, which arguments mostly are.
 *
 *   eval "$(scmjs completion bash)"                          # ~/.bashrc
 *   scmjs completion zsh > ~/.zsh/completions/_scmjs         # a folder on $fpath
 *   scmjs completion fish > ~/.config/fish/completions/scmjs.fish
 */
import type { Command, Option } from "commander";

export const SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

/** An option as the shells need it: its flags, whether it takes a value, and what the value may be. */
interface Opt { flags: string[]; description: string; value: "none" | "file" | "word"; choices: string[] | null }
/** An argument: its choices, or a file. */
interface Arg { choices: string[] | null; variadic: boolean }
interface Node { name: string; description: string; options: Opt[]; children: Node[]; args: Arg[]; runs: boolean }

/** A value named like one of these is a path, and completes as a file; any other value has no completion. */
const PATHLIKE = /file|folder|map|path|png|replay|dir|mod|bot|plugin|baseline|tests|members|project|starcraft|where/i;

function optionOf(o: Option): Opt {
  const name = /<([^>]+)>/.exec(o.flags)?.[1] ?? "";
  // An optional value (`--baseline [file]`) is left as a flag: the next word may as well be a map.
  const value = !o.required ? "none" : o.argChoices?.length || !PATHLIKE.test(name) ? "word" : "file";
  return { flags: [o.long, o.short].filter((f): f is string => !!f), description: o.description, value, choices: o.argChoices ?? null };
}

/**
 * The tree commander holds. Hidden options are left out (old spellings), and hidden commands are kept: the guide
 * documents each (`about`, `lsp`, `completion`, `login`, `logout`, `help`). The global `--lang` is everywhere, so a
 * value after it is never taken for a command.
 */
export function commandTree(cmd: Command, top = true): Node {
  const options = cmd.options.filter((o) => !o.hidden).map(optionOf);
  if (!options.some((o) => o.flags.includes("--lang"))) options.push({ flags: ["--lang"], description: "the language: en or ko", value: "word", choices: ["en", "ko"] });
  // `help` once, at the top: under a noun it is the same command again.
  const children = cmd.commands.filter((c) => top || c.name() !== "help").map((c) => commandTree(c, false));
  const runs = !!(cmd as unknown as { _actionHandler?: unknown })._actionHandler;
  let args: Arg[] = cmd.registeredArguments.map((a) => ({ choices: a.argChoices ?? null, variadic: a.variadic }));
  // `scmjs help <command>`: the commands.
  if (!top && cmd.name() === "help" && cmd.parent && !cmd.parent.parent) args = [{ choices: cmd.parent.commands.map((c) => c.name()).filter((n) => n !== "help"), variadic: false }];
  return { name: cmd.name(), description: cmd.description(), options, children, args, runs };
}

export function completionScript(program: Command, shell: Shell): string {
  const tree = commandTree(program);
  return { bash: bash(tree), zsh: zsh(tree), fish: fish(tree) }[shell];
}

const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** Every command with the words that lead to it, the root first. */
function paths(n: Node, prefix: string[] = []): { path: string[]; node: Node }[] {
  return [{ path: prefix, node: n }, ...n.children.flatMap((c) => paths(c, [...prefix, c.name]))];
}

function bash(root: Node): string {
  const all = paths(root);
  const key = (path: string[]) => sq(path.join(" "));
  const children = all.filter(({ node }) => node.children.length).map(({ path, node }) => `    ${key(path)}) echo ${sq(node.children.map((c) => c.name).join(" "))} ;;`).join("\n");
  const options = all.map(({ path, node }) => `    ${key(path)}) echo ${sq(node.options.flatMap((o) => o.flags).join(" "))} ;;`).join("\n");
  // The value an option takes: its choices, @file for a path, @word for anything else; nothing for a flag.
  const values = all.flatMap(({ path, node }) => node.options.filter((o) => o.value !== "none" && !o.flags.includes("--lang")).flatMap((o) => o.flags.map((f) =>
    `    ${sq(`${path.join(" ")}|${f}`)}) echo ${sq(o.choices ? o.choices.join(" ") : `@${o.value}`)} ;;`))).join("\n");
  // A command's arguments: words for the first ones with choices, @file for the rest, nothing past the last.
  const args = all.filter(({ node }) => node.runs).flatMap(({ path, node }) => {
    const rows: string[] = [];
    node.args.forEach((a, i) => rows.push(`    ${sq(`${path.join(" ")}|${i}`)}) echo ${sq(a.choices ? a.choices.join(" ") : "@file")} ;;`));
    const last = node.args.at(-1);
    if (last?.variadic) rows.push(`    ${sq(`${path.join(" ")}|`)}*) echo ${sq(last.choices ? last.choices.join(" ") : "@file")} ;;`);
    return rows;
  }).join("\n");
  const name = root.name;
  return `# bash completion for ${name}, generated by \`${name} completion bash\`
_${name}_children() {
  case "$1" in
${children}
  esac
}
_${name}_options() {
  case "$1" in
${options}
  esac
}
_${name}_value() {
  case "$1|$2" in
${values}
    *'|--lang') echo 'en ko' ;;
  esac
}
_${name}_args() {
  case "$1|$2" in
${args}
  esac
}
_${name}() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" prev="" node="" n=0 i w v subs
  # The typed words walked down the tree: a command's name goes deeper, an option is skipped with its value.
  for ((i = 1; i < COMP_CWORD; i++)); do
    w="\${COMP_WORDS[i]}"
    if [[ "$w" == -* ]]; then
      if [[ "$w" != *=* && -n "$(_${name}_value "$node" "$w")" ]]; then
        if ((i + 1 == COMP_CWORD)); then prev="$w"; else ((i++)); fi
      fi
      continue
    fi
    if ((n == 0)) && [[ " $(_${name}_children "$node") " == *" $w "* ]]; then node="\${node:+$node }$w"; else ((n++)); fi
  done
  COMPREPLY=()
  if [[ -n "$prev" ]]; then
    v="$(_${name}_value "$node" "$prev")"
    case "$v" in
      @file) COMPREPLY=( $(compgen -f -- "$cur") ) ;;
      @word) ;;
      *) COMPREPLY=( $(compgen -W "$v" -- "$cur") ) ;;
    esac
    return 0
  fi
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$(_${name}_options "$node")" -- "$cur") )
    return 0
  fi
  ((n == 0)) && subs="$(_${name}_children "$node")"
  v="$(_${name}_args "$node" "$n")"
  case "$v" in
    @file) COMPREPLY=( $(compgen -W "$subs" -- "$cur") $(compgen -f -- "$cur") ) ;;
    *) COMPREPLY=( $(compgen -W "$subs $v" -- "$cur") ) ;;
  esac
  # A command that takes nothing more offers its options.
  if [[ -z "$subs" && -z "$v" ]]; then COMPREPLY=( $(compgen -W "$(_${name}_options "$node")" -- "$cur") ); fi
  return 0
}
complete -o filenames -F _${name} ${name}
`;
}

/** zsh's spec of an option: `--format[what it is]:value:(a b c)`, `:file:_files` for a path. */
function zshOption(o: Opt, flag: string): string {
  const what = `${flag}[${o.description.replace(/[[\]]/g, "")}]`;
  if (o.value === "none") return sq(what);
  const action = o.choices ? `(${o.choices.join(" ")})` : o.value === "file" ? "_files" : " ";
  return sq(`${what}:value:${action}`);
}

function zsh(root: Node): string {
  const fn = (path: string[]) => `_${root.name}${path.map((p) => `_${p.replace(/[^\w]/g, "_")}`).join("")}`;
  const argSpec = (node: Node) => {
    const specs = node.args.map((a, i) => sq(`${a.variadic ? "*" : String(i + 1)}:${a.variadic ? "file" : "arg"}:${a.choices ? `(${a.choices.join(" ")})` : "_files"}`));
    return specs;
  };
  const functions = paths(root).map(({ path, node }) => {
    const opts = node.options.flatMap((o) => o.flags.map((f) => `    ${zshOption(o, f)}`));
    if (node.children.length === 0) {
      return `${fn(path)}() {\n  _arguments -s \\\n${[...opts, ...argSpec(node).map((s) => `    ${s}`)].join(" \\\n")}\n}`;
    }
    const subs = node.children.map((c) => sq(`${c.name}:${c.description.replace(/:/g, "\\:")}`)).join(" ");
    const dispatch = node.children.map((c) => `        ${c.name}) ${fn([...path, c.name])} ;;`).join("\n");
    // A command that runs by itself too (`map test <map>` beside `map test record`) offers files beside its commands.
    const first = node.runs ? `_describe 'command' subs; _files` : `_describe 'command' subs`;
    const rest = node.runs ? `\n        *) _files ;;` : "";
    return `${fn(path)}() {
  local -a subs
  subs=(${subs})
  _arguments -C \\
${opts.length ? `${opts.join(" \\\n")} \\\n` : ""}    '1: :->command' \\
    '*::arg:->args'
  case $state in
    command) ${first} ;;
    args)
      case $words[1] in
${dispatch}${rest}
      esac ;;
  esac
}`;
  }).join("\n\n");
  return `#compdef ${root.name}
# zsh completion for ${root.name}, generated by \`${root.name} completion zsh\`

${functions}

${fn([])} "$@"
`;
}

function fish(root: Node): string {
  const name = root.name;
  const all = paths(root);
  const lines: string[] = [`# fish completion for ${name}, generated by \`${name} completion fish\``, ""];
  // The path of commands typed so far, options and their values skipped (`--lang ko` is not a command).
  lines.push(`function __${name}_children`, "  switch $argv[1]");
  for (const { path, node } of all.filter((p) => p.node.children.length)) lines.push(`    case ${sq(path.join(" "))}`, `      printf '%s\\n' ${node.children.map((c) => c.name).join(" ")}`);
  lines.push("  end", "end", "");
  lines.push(`function __${name}_takes_value`, '  switch "$argv[1]|$argv[2]"');
  const takes = all.flatMap(({ path, node }) => node.options.filter((o) => o.value !== "none" && !o.flags.includes("--lang")).flatMap((o) => o.flags.map((f) => sq(`${path.join(" ")}|${f}`))));
  lines.push(`    case '*|--lang' ${takes.join(" ")}`, "      return 0", "  end", "  return 1", "end", "");
  lines.push(`function __${name}_path`,
    "  set -l tokens (commandline -opc)",
    "  set -e tokens[1]",
    "  set -l path ''",
    "  set -l skip 0",
    "  set -l args 0",
    "  for w in $tokens",
    "    if test $skip = 1",
    "      set skip 0",
    "      continue",
    "    end",
    "    switch $w",
    "      case '--*=*'",
    "        continue",
    "      case '-*'",
    `        if __${name}_takes_value "$path" $w`,
    "          set skip 1",
    "        end",
    "        continue",
    "    end",
    `    if test $args = 0; and contains -- $w (__${name}_children "$path")`,
    '      set path (string trim -- "$path $w")',
    "    else",
    "      set args (math $args + 1)",
    "    end",
    "  end",
    '  echo "$path"',
    "end",
    "",
    `function __${name}_at`,
    `  set -l path (__${name}_path)`,
    '  test "$path" = "$argv"',
    "end",
    "");
  for (const { path, node } of all) {
    const cond = sq(`__${name}_at${path.length ? ` ${path.join(" ")}` : ""}`);
    // A noun takes its commands only: no files.
    if (node.children.length && !node.runs) lines.push(`complete -c ${name} -n ${cond} -f`);
    for (const c of node.children) lines.push(`complete -c ${name} -n ${cond}${node.runs ? "" : " -f"} -a ${c.name} -d ${sq(c.description)}`);
    const choices = node.args[0]?.choices;
    if (choices) lines.push(`complete -c ${name} -n ${cond} -f -a ${sq(choices.join(" "))}`);
    if (node.runs && !node.args.length) lines.push(`complete -c ${name} -n ${cond} -f`);
    for (const o of node.options) {
      const flags = o.flags.map((f) => (f.startsWith("--") ? `-l ${f.slice(2)}` : `-s ${f.slice(1)}`)).join(" ");
      const value = o.value === "none" ? "" : o.choices ? ` -x -a ${sq(o.choices.join(" "))}` : o.value === "file" ? " -r -F" : " -x";
      lines.push(`complete -c ${name} -n ${cond} ${flags}${value} -d ${sq(o.description)}`);
    }
  }
  return lines.join("\n") + "\n";
}
