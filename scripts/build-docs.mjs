/**
 * `npm run build:docs`: docs.scmjs.dev, built out of the repository's own documentation.
 *
 * Two halves, and only one of them is generated in any interesting sense:
 *
 *   guides   `README.md` and `docs/*.md`, split at their `##` headings into pages and
 *            rendered. These stay the source and are still read on GitHub; this puts the
 *            same words at a URL, with navigation and working cross-links. Nothing here
 *            writes prose — a generator that did would be a fifth document to keep
 *            current, against the four `CLAUDE.md` names.
 *   API      the plugin API reference, read out of the single `index.d.ts` that
 *            `scripts/build-plugin-types.mjs` bundles from `src/plugins/api.ts` — the
 *            same file plugin repositories compile against. `api.ts` is already
 *            thoroughly commented; that is only visible in an editor tooltip today, and
 *            this makes it a page. A member with no comment shows as a bare signature,
 *            which is the true picture of the contract and a thing to fix in `api.ts`.
 *
 * The site is plain static HTML with one stylesheet, like `scm-js/site`. It carries no
 * game data and fetches nothing at runtime.
 *
 *   node scripts/build-docs.mjs                    # → docs-site/
 *   node scripts/build-docs.mjs --out DIR
 *   node scripts/build-docs.mjs --domain docs.scmjs.dev    # write a CNAME too
 *   node scripts/build-docs.mjs --base /docs       # served somewhere other than the root
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assignTypes, buildReference, slugOf } from "./lib/docs/api.mjs";
import { headingsIn, renderMarkdown } from "./lib/docs/markdown.mjs";
import { codeBlock, escapeHtml, memberHtml, navHtml, page, tocHtml, typeHtml } from "./lib/docs/render.mjs";
import { buildGuide, IMAGES_DIR, linkResolver, REPO_URL, SOURCES } from "./lib/docs/site.mjs";

const root = resolve(import.meta.dirname, "..");
const EDITOR_URL = "https://editor.scmjs.dev";
const API_DTS = join(root, "plugin-api/index.d.ts");

/**
 * The plugin repositories, as worked examples. Each is a real plugin that leans on the
 * groups named — `docs/plugins.md` ends with the same list in prose — so a reader who
 * wants more than a signature has somewhere to go that is guaranteed to compile against
 * the version being documented. Written down here rather than derived: which plugin best
 * *demonstrates* a group is a judgement, not a fact in the code.
 */
export const EXAMPLE_PLUGINS = [
  { repo: "plugin-hello-world", name: "Hello World", groups: ["menu", "ui"], of: "the smallest complete plugin: one menu item and one dialog, to copy from" },
  { repo: "plugin-paint", name: "Paint", groups: ["ui", "palette", "document"], of: "map tools, a floating panel, and painting with the active layer's brush" },
  { repo: "plugin-walkability", name: "Walkability", groups: ["ui", "tileset", "query", "view"], of: "a read-only overlay drawn over the map" },
  { repo: "plugin-section-explorer", name: "Section Explorer", groups: ["document", "names"], of: "raw section bytes, re-parsed into the open map" },
  { repo: "plugin-repair", name: "Repair", groups: ["document", "text", "events"], of: "checking a file on open and repairing it" },
  { repo: "plugin-melee-wizard", name: "Melee Wizard", groups: ["query", "document", "ui"], of: "placing units with the editor's own placement checks" },
  { repo: "plugin-image-to-terrain", name: "Terrain from Image", groups: ["terrain", "ui"], of: "an image turned into terrain, one transaction" },
  { repo: "plugin-scm-scx", name: "scmscx.com", groups: ["document", "ui"], of: "opening a map fetched from elsewhere" },
  { repo: "plugin-trigger-script", name: "Trigger Script", groups: ["triggers", "commands"], of: "generating a run of triggers and claiming it" },
];

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function write(out, url, html) {
  const path = join(out, url.replace(/^\//, ""), "index.html");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

/** The guides, split into pages, and the resolver that makes their links work here. */
function buildGuides() {
  const guides = SOURCES.map((source) => buildGuide(source, read(source.file)));
  return { guides, resolve: linkResolver(guides) };
}

/** The API reference: groups, the types each group owns, and the shared ones. */
function buildApi() {
  let dts;
  try {
    dts = readFileSync(API_DTS, "utf8");
  } catch {
    throw new Error("plugin-api/index.d.ts is not there. Run `npm run build:plugin-types` first.");
  }
  const reference = buildReference(dts);
  const { perGroup, shared } = assignTypes(reference);
  const version = /version (\d+)/.exec(dts.slice(0, 400))?.[1] ?? String(reference.root.members.length);
  return { reference, perGroup, shared, apiVersion: version };
}

/**
 * Where every declared type name is documented, so a signature can link to it. A type a
 * group owns is on that group's page; everything else is on the shared types page.
 */
function typeUrls(api, base) {
  const urls = new Map();
  for (const [slug, types] of api.perGroup) for (const t of types) urls.set(t.name, `${base}/api/${slug}/#${anchor(t.name)}`);
  for (const t of api.shared) urls.set(t.name, `${base}/api/types/#${anchor(t.name)}`);
  for (const g of api.reference.groups) urls.set(g.name, `${base}/api/${g.slug}/`);
  urls.set("PluginApi", `${base}/api/`);
  return urls;
}

const anchor = (name) => name.toLowerCase();

function main(argv) {
  const at = argv.indexOf("--out");
  const out = at === -1 ? join(root, "docs-site") : resolve(argv[at + 1] ?? "");
  const domainAt = argv.indexOf("--domain");
  const domain = domainAt === -1 ? "" : argv[domainAt + 1] ?? "";
  const baseAt = argv.indexOf("--base");
  const base = baseAt === -1 ? "" : (argv[baseAt + 1] ?? "").replace(/\/$/, "");
  const version = JSON.parse(read("package.json")).version;

  const { guides, resolve: resolveLink } = buildGuides();
  const api = buildApi();

  /* The sidebar is the same on every page: the five guides, then the reference. */
  const tree = [
    ...guides.map((g) => ({ title: g.title, url: `${base}${g.url}`, pages: g.pages.map((p) => ({ title: p.title, url: `${base}${p.url}` })) })),
    {
      title: "API reference",
      url: `${base}/api/`,
      pages: [
        ...api.reference.groups.map((g) => ({ title: `api.${g.property}`, url: `${base}/api/${g.slug}/` })),
        { title: "Shared types", url: `${base}/api/types/` },
      ],
    },
  ];

  const urls = typeUrls(api, base);
  const codeOpts = {
    names: api.reference.names,
    urlFor: (name) => urls.get(name) ?? null,
    idFor: anchor,
    rewriteLink: (href) => resolveLink("docs/plugins.md", href),
  };

  const index = [];
  const emit = ({ section, headings = [], ...opts }) => {
    const html = page({
      ...opts,
      nav: navHtml(tree, opts.url, ""),
      version,
      editorUrl: EDITOR_URL,
      repoUrl: REPO_URL,
      base,
    });
    write(out, opts.url, html);
    index.push({
      t: opts.title,
      u: opts.url.slice(base.length) || "/",
      s: section,
      h: headings,
      // Capped: the index is fetched whole, and the tail of a long page is not what a
      // one-word query is looking for.
      b: plainTextOf(opts.body).slice(0, 6000),
    });
  };

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  /* ── home ── */
  emit({
    title: "scmJS documentation",
    description: "Guides and the plugin API reference for scmJS, a StarCraft: Brood War map editor that runs in a browser tab.",
    url: `${base}/`,
    section: "Home",
    body: homeHtml(guides, api, base),
  });

  /* ── the guides ── */
  for (const guide of guides) {
    const intro = guide.intro ? renderMarkdown(guide.intro, { shift: 0, rewriteLink: (h) => resolveLink(guide.file, h) }) : "";
    emit({
      title: guide.title,
      description: guide.blurb,
      url: `${base}${guide.url}`,
      section: guide.title,
      headings: guide.pages.map((p) => p.title),
      body: `<h1>${escapeHtml(guide.title)}</h1>
<p class="lede">${escapeHtml(guide.blurb)}</p>
${intro}
<ul class="cards">
${guide.pages.map((p) => `<li><a class="card" href="${base}${p.url}"><b>${escapeHtml(p.title)}</b><span>${escapeHtml(firstLine(p.body))}</span></a></li>`).join("\n")}
</ul>`,
    });
    for (const p of guide.pages) {
      emit({
        title: p.title,
        description: firstLine(p.body),
        url: `${base}${p.url}`,
        section: guide.title,
        headings: p.headings.map((h) => h.text),
        toc: tocHtml(p.headings),
        body: `<h1>${escapeHtml(p.title)}</h1>\n${renderMarkdown(p.body, { shift: -1, rewriteLink: (h) => resolveLink(guide.file, h) })}`,
      });
    }
  }

  /* ── the API reference ── */
  emit({
    title: "API reference",
    description: `Every call a scmJS plugin can make — plugin API version ${api.apiVersion}, generated from the editor's own declarations.`,
    url: `${base}/api/`,
    section: "API reference",
    headings: api.reference.groups.map((g) => `api.${g.property}`),
    body: apiIndexHtml(api, base, codeOpts),
  });

  for (const group of api.reference.groups) {
    const types = api.perGroup.get(group.slug) ?? [];
    const examples = EXAMPLE_PLUGINS.filter((p) => p.groups.includes(group.property));
    emit({
      title: `api.${group.property}`,
      description: group.summary || `${group.name}: the ${group.property} group of the scmJS plugin API.`,
      url: `${base}/api/${group.slug}/`,
      toc: tocHtml([
        ...group.members.map((m) => ({ slug: anchor(m.name), text: m.name })),
        ...types.map((t) => ({ slug: anchor(t.name), text: t.name })),
      ]),
      section: "API reference",
      headings: [...group.members.map((m) => m.name), ...types.map((t) => t.name)],
      body: groupHtml(group, types, examples, codeOpts),
    });
  }

  emit({
    title: "Shared types",
    description: "The types more than one group of the scmJS plugin API names.",
    url: `${base}/api/types/`,
    toc: tocHtml(api.shared.map((t) => ({ slug: anchor(t.name), text: t.name }))),
    body: `<h1>Shared types</h1>
<p class="lede">The declarations more than one group names — everything else is documented on the page of the group that uses it.</p>
<ul class="chips">${api.shared.map((t) => `<li><a href="#${anchor(t.name)}">${escapeHtml(t.name)}</a></li>`).join("")}</ul>
${api.shared.map((t) => typeHtml(t, codeOpts)).join("\n")}`,
    section: "API reference",
    headings: api.shared.map((t) => t.name),
  });

  /* ── assets ── */
  cpSync(join(root, "scripts/lib/docs/assets"), out, { recursive: true });
  cpSync(join(root, IMAGES_DIR), join(out, "images"), { recursive: true });
  writeFileSync(join(out, "search.json"), JSON.stringify(index));
  writeFileSync(join(out, ".nojekyll"), "");
  if (domain) writeFileSync(join(out, "CNAME"), `${domain}\n`);

  const pages = countPages(guides, api);
  console.log(`docs: ${out} — ${pages} pages, ${api.reference.groups.length} API groups, ${api.reference.types.length} types (plugin API ${api.apiVersion}, editor ${version}).`);
}

function countPages(guides, api) {
  return 1 + guides.length + guides.reduce((n, g) => n + g.pages.length, 0) + 1 + api.reference.groups.length + 1;
}

/**
 * The search index: one entry per page, with its headings and its text.
 *
 * Search on a static site is a JSON file and a scan in the browser — no service to run
 * and nothing fetched until somebody uses the box (`assets/search.js`). The text is the
 * rendered page with its tags taken off, which is why this happens at write time rather
 * than over the Markdown: the API pages have no Markdown behind them.
 */
export function plainTextOf(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|hellip|mdash|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", hellip: "…", mdash: "—", nbsp: " " })[e])
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence of a page's body, for a card and a `<meta name=description>`. */
export function firstLine(body) {
  const text = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6} .*$/gm, "")
    .replace(/^[-*] .*$/gm, "")
    .replace(/^\|.*$/gm, "")
    .trim();
  const para = text.split(/\n\s*\n/)[0] ?? "";
  const plain = para
    .replace(/\s+/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  const stop = plain.search(/\.\s|\.$/);
  const sentence = stop === -1 ? plain : plain.slice(0, stop + 1);
  return sentence.length > 190 ? `${sentence.slice(0, 187)}…` : sentence;
}

function homeHtml(guides, api, base) {
  return `<h1>scmJS documentation</h1>
<p class="lede">A StarCraft: Brood War map editor that runs in a browser tab — it opens real <code>.scm</code> and <code>.scx</code> files, draws terrain from the game's own tileset graphics, and writes playable archives back.</p>
<p>These pages are the repository's own guides, and a reference generated from the plugin API's declarations. The editor itself is at <a href="${EDITOR_URL}">editor.scmjs.dev</a>.</p>
<ul class="cards">
${guides.map((g) => `<li><a class="card" href="${base}${g.url}"><b>${escapeHtml(g.title)}</b><span>${escapeHtml(g.blurb)}</span></a></li>`).join("\n")}
<li><a class="card" href="${base}/api/"><b>API reference</b><span>Every call a plugin can make, group by group — plugin API version ${api.apiVersion}.</span></a></li>
</ul>
<h2 id="start">Where to start</h2>
<ul>
<li>New to the editor: <a href="${base}/guide/getting-started/">Getting started</a>, then <a href="${base}/guide/your-first-map/">Your first map</a>.</li>
<li>Wondering whether it does the thing you need: <a href="${base}/guide/what-works-and-what-does-not/">What works, and what does not</a>.</li>
<li>Installing a plugin, or wondering what one may do: <a href="${base}/plugins/using-plugins/">Using plugins</a>.</li>
<li>Writing a plugin: <a href="${base}/plugins/writing-a-plugin/">Writing a plugin</a>, then the <a href="${base}/api/">API reference</a>; <a href="https://github.com/scm-js/plugin-hello-world">Hello World</a> is the repository to copy.</li>
<li>Working on the editor itself: <a href="${base}/development/">Development</a> and <a href="${base}/map-files/">Map files</a>.</li>
</ul>`;
}

function apiIndexHtml(api, base, opts) {
  const { reference, apiVersion } = api;
  const rows = reference.groups.map((g) => `<tr>
<th><a href="${base}/api/${g.slug}/"><code>api.${escapeHtml(g.property)}</code></a></th>
<td>${g.summary ? renderMarkdown(g.summary, { shift: 4, headingIds: false, rewriteLink: opts.rewriteLink }) : `<p>${escapeHtml(g.name)}</p>`}</td>
</tr>`).join("\n");
  const plain = reference.plain.map((m) => `<li><code>api.${escapeHtml(m.name)}</code> — ${m.summary ? escapeHtml(stripMd(m.summary)) : escapeHtml(m.type || m.signature)}</li>`).join("\n");
  return `<h1>API reference</h1>
<p class="lede">Everything a plugin can see and do, as the editor declares it. Plugin API version ${apiVersion}; generated from <code>src/plugins/api.ts</code>, the same declarations <a href="https://www.npmjs.com/package/@scm-js/plugin-api"><code>@scm-js/plugin-api</code></a> publishes.</p>
<p>A plugin is one <code>activate(api)</code> function. Everything below hangs off that argument.</p>
${codeBlock(`import type { PluginApi } from "@scm-js/plugin-api";

export default function activate(api: PluginApi) {
  api.menu.add("Tools", { label: "Say hello", run: () => api.ui.toast({ title: "Hello" }) });
}`, opts)}
<p>Nothing here is written by hand. A member with no description has no doc comment in <code>api.ts</code>; the fix belongs there, not on this page.</p>
<h2 id="groups">Groups</h2>
<table><tbody>
${rows}
</tbody></table>
<h2 id="root">On the api object itself</h2>
<ul>
${plain}
<li><code>api.plugin</code> — the manifest of the plugin this <code>api</code> belongs to (<a href="${base}/api/types/#plugininfo"><code>PluginInfo</code></a>).</li>
</ul>
<h2 id="examples">Plugins to read</h2>
<p>Every plugin the editor ships is a repository of its own, compiled against these declarations; <a href="${base}/plugins/plugins-to-read/">Plugins to read</a> says what each one demonstrates.</p>
<ul class="cards">
${EXAMPLE_PLUGINS.map((p) => `<li><a class="card" href="${REPO_URL.replace("/scm-js/scm-js", "/scm-js")}/${p.repo}"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.of)}</span></a></li>`).join("\n")}
</ul>`;
}

function groupHtml(group, types, examples, opts) {
  const summary = group.summary ? renderMarkdown(group.summary, { shift: 0, headingIds: false, rewriteLink: opts.rewriteLink }) : "";
  const detail = group.detail ? renderMarkdown(group.detail, { shift: 0, headingIds: false, rewriteLink: opts.rewriteLink }) : "";
  const seeAlso = examples.length > 0
    ? `<h2 id="seen-in">Seen in</h2>
<ul class="cards">${examples.map((p) => `<li><a class="card" href="https://github.com/scm-js/${p.repo}"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.of)}</span></a></li>`).join("")}</ul>`
    : "";
  return `<h1>api.${escapeHtml(group.property)}</h1>
<p class="lede">${escapeHtml(group.name)}</p>
${summary}
${detail}
<ul class="chips">${group.members.map((m) => `<li><a href="#${m.name.toLowerCase()}">${escapeHtml(m.name)}</a></li>`).join("")}</ul>
<h2 id="members">Members</h2>
${group.members.map((m) => memberHtml(m, opts)).join("\n")}
${types.length > 0 ? `<h2 id="types">Types</h2>\n<p>Declarations only this group names.</p>\n${types.map((t) => typeHtml(t, opts)).join("\n")}` : ""}
${seeAlso}`;
}

function stripMd(text) {
  return text.replace(/\s+/g, " ").replace(/`([^`]*)`/g, "$1").trim();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`docs: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

export { buildApi, buildGuides, slugOf, headingsIn };
