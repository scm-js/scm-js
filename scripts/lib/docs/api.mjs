/**
 * The generated half of the site: the plugin API reference, read out of the one bundled
 * declaration file `scripts/build-plugin-types.mjs` already produces.
 *
 * `src/plugins/api.ts` is the contract and it is thoroughly commented — but a doc comment
 * is only visible in an editor tooltip, to somebody who has already installed the package
 * and opened the right file. This turns the same comments into pages, so `api.terrain`
 * can be read before a plugin exists. Nothing here is written by hand: a member with no
 * doc comment shows as a bare signature, which is the honest picture of the contract and
 * the thing to fix in `api.ts` rather than here.
 *
 * It parses the *bundle* rather than the source tree because the bundle is what plugin
 * authors compile against — one file, no imports, every type it names inside it (see
 * `build-plugin-types.mjs`), which is exactly the closure a reference should cover.
 */
import ts from "typescript";

/** `PluginApi`'s members are the reference's pages; `log` is a method, not a group. */
export const ROOT = "PluginApi";

/**
 * A `/** … *\/` comment immediately above a node, with its `*` margin stripped.
 *
 * Read out of the leading trivia rather than through `node.jsDoc`, which is not public
 * API, and taking the *last* comment in the run so a licence banner or a `//` note
 * between two declarations cannot be mistaken for the next one's documentation.
 */
export function docCommentFor(node, source) {
  const trivia = source.slice(node.getFullStart(), node.getStart(node.getSourceFile()));
  const matches = [...trivia.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  const last = matches.at(-1);
  if (!last) return "";
  // Only strip a margin that is really there: an ASCII table or an indented code sample
  // inside a comment has lines that do not start with `*`, and cutting them at a fixed
  // column would take their first character off.
  return last[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

/**
 * A doc comment split into what it says and its `@` tags. `@example` becomes a code
 * block on the page; the rest is listed as written, so a tag added to `api.ts` later
 * shows up here instead of being swallowed.
 */
export function parseDoc(comment) {
  if (!comment) return { summary: "", examples: [], tags: [] };
  const lines = comment.split("\n");
  const summary = [];
  const tags = [];
  let current = null;
  for (const line of lines) {
    const m = /^@(\w+)[ \t]*(.*)$/.exec(line);
    if (m) {
      current = { name: m[1], lines: m[2] ? [m[2]] : [] };
      tags.push(current);
    } else if (current) current.lines.push(line);
    else summary.push(line);
  }
  const text = (t) => t.lines.join("\n").trim();
  return {
    summary: summary.join("\n").trim(),
    examples: tags.filter((t) => t.name === "example").map(text),
    tags: tags.filter((t) => t.name !== "example").map((t) => ({ name: t.name, text: text(t) })),
  };
}

/** One member of an interface: its name, the signature as written, and its documentation. */
function memberOf(node, source) {
  const name = node.name ? node.name.getText() : "";
  const text = node.getText().replace(/\s+/g, " ").trim();
  const doc = parseDoc(docCommentFor(node, source));
  const kind = ts.isMethodSignature(node) || ts.isCallSignatureDeclaration(node) ? "method" : "property";
  const optional = Boolean(node.questionToken);
  const type = node.type ? node.type.getText().replace(/\s+/g, " ").trim() : "";
  return { name, kind, optional, type, signature: text, ...doc };
}

/**
 * Every top-level declaration in the bundle, in the order it is declared — which is the
 * order `dts-bundle-generator` emits, so related types stay near each other.
 */
export function parseDeclarations(source, fileName = "index.d.ts") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const decls = [];
  for (const node of file.statements) {
    const doc = parseDoc(docCommentFor(node, source));
    if (ts.isInterfaceDeclaration(node)) {
      decls.push({
        kind: "interface",
        name: node.name.text,
        ...doc,
        members: node.members.map((m) => memberOf(m, source)),
        signature: `interface ${node.name.text}`,
      });
    } else if (ts.isTypeAliasDeclaration(node)) {
      decls.push({
        kind: "type",
        name: node.name.text,
        ...doc,
        members: [],
        signature: node.getText().replace(/^export\s+/, "").trim(),
      });
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      decls.push({ kind: "function", name: node.name.text, ...doc, members: [], signature: node.getText().replace(/^export\s+declare\s+/, "").trim() });
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        decls.push({ kind: "const", name: d.name.text, ...doc, members: [], signature: `const ${d.getText()}`.trim() });
      }
    }
  }
  return decls;
}

/**
 * The reference, as pages: one per `PluginApi` group (`api.document`, `api.terrain`, …),
 * plus everything else as supporting types.
 *
 * A group is a `PluginApi` property whose type is an interface named `…Api`, which is
 * `api.ts`'s own convention — so adding a group there adds a page here. What is left
 * (`apiVersion`, `plugin`, `log`) is data or a single function and stays on the
 * overview; `plugin`'s `PluginInfo` is documented with the other types rather than
 * given a page of its own, because it is a record the host hands over, not a group of
 * calls.
 */
export function buildReference(source) {
  const decls = parseDeclarations(source);
  const byName = new Map(decls.map((d) => [d.name, d]));
  const root = byName.get(ROOT);
  if (!root) throw new Error(`The bundle does not declare ${ROOT}; the reference cannot be built from it.`);

  const groups = [];
  const plain = [];
  for (const member of root.members) {
    const target = byName.get(member.type);
    if (member.kind === "property" && isGroupType(member.type) && target?.kind === "interface") {
      groups.push({
        property: member.name,
        name: member.type,
        slug: slugOf(member.name),
        // The group's own description is whatever `PluginApi` says about the property,
        // else what the interface says about itself. Both are often there and they say
        // different things; the property's is the one written for a reader of `api.*`.
        summary: member.summary || target.summary,
        detail: member.summary && target.summary !== member.summary ? target.summary : "",
        examples: [...member.examples, ...target.examples],
        members: target.members,
      });
    } else plain.push(member);
  }

  const covered = new Set([ROOT, ...groups.map((g) => g.name)]);
  const types = decls.filter((d) => !covered.has(d.name));
  return { root, groups, plain, types, names: new Set(decls.map((d) => d.name)) };
}

/** The naming convention `api.ts` uses for a group of calls, and this reads as the grouping. */
export function isGroupType(name) {
  return name.endsWith("Api");
}

/** `contextMenu` → `context-menu`: the group's path segment. */
export function slugOf(property) {
  return property.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Every declared name a declaration mentions, which is what a "see also" is made of. */
export function referencesOf(decl, names) {
  const out = new Set();
  const scan = (text) => {
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) if (names.has(m[0]) && m[0] !== decl.name) out.add(m[0]);
  };
  scan(decl.signature ?? "");
  for (const m of decl.members ?? []) scan(m.signature ?? "");
  return out;
}

/**
 * Which page a supporting type belongs on.
 *
 * 240-odd types on one page is a document nobody scrolls, so a type only one API group
 * can reach is documented *on that group's page* — reading `api.terrain` you get
 * `TerrainPick` under it rather than a link somewhere else. What two groups share, or
 * what nothing reaches from a group at all, goes on the shared types page. Reachability
 * is transitive: `IsomReport` names `Diamond`, and both belong with `terrain`.
 */
export function assignTypes(reference) {
  const { groups, types, names } = reference;
  const byName = new Map(types.map((t) => [t.name, t]));
  const refs = new Map(types.map((t) => [t.name, referencesOf(t, names)]));
  const owners = new Map();
  for (const group of groups) {
    const seen = new Set();
    const stack = [...referencesOf({ name: group.name, members: group.members, signature: "" }, names)];
    while (stack.length > 0) {
      const name = stack.pop();
      if (seen.has(name) || !byName.has(name)) continue;
      seen.add(name);
      for (const next of refs.get(name) ?? []) stack.push(next);
    }
    for (const name of seen) {
      const at = owners.get(name);
      if (at === undefined) owners.set(name, group.slug);
      else if (at !== group.slug) owners.set(name, null); // shared
    }
  }
  const perGroup = new Map(groups.map((g) => [g.slug, []]));
  const shared = [];
  for (const type of types) {
    const owner = owners.get(type.name);
    if (owner) perGroup.get(owner).push(type);
    else shared.push(type);
  }
  return { perGroup, shared };
}
