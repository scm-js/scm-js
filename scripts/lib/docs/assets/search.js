/* Search, such as a static site can have one: a JSON index built beside the pages,
   fetched the first time the box is used, and scanned in the page. No service, no
   dependency, and nothing runs until somebody types. */
(() => {
  const box = document.querySelector("#q");
  const results = document.querySelector("#results");
  if (!box || !results) return;
  const base = box.dataset.base ?? "";

  let index = null;
  let loading = null;
  const load = () => (loading ??= fetch(`${base}/search.json`).then((r) => r.json()).then((d) => (index = d)).catch(() => (index = [])));

  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

  /* Every term has to appear somewhere, and where it appears is the score: a title is
     worth more than a heading, a heading more than the body. Substrings count, so
     "isom" finds `hasIsom` without an index of word stems. */
  function search(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const hits = [];
    for (const page of index) {
      const title = page.t.toLowerCase();
      const heads = page.h.join(" ").toLowerCase();
      const body = page.b.toLowerCase();
      let score = 0;
      let all = true;
      for (const term of terms) {
        const inTitle = title.includes(term);
        const inHeads = heads.includes(term);
        const at = body.indexOf(term);
        if (!inTitle && !inHeads && at === -1) { all = false; break; }
        score += (inTitle ? 40 : 0) + (title.startsWith(term) ? 20 : 0) + (inHeads ? 8 : 0) + (at === -1 ? 0 : 3);
      }
      if (all) hits.push({ page, score, at: body.indexOf(terms[0]) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, 12);
  }

  function snippet(page, at, term) {
    if (at < 0) return page.b.slice(0, 120);
    const from = Math.max(0, at - 45);
    const text = page.b.slice(from, from + 150);
    const html = escape(text).replace(new RegExp(escape(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), (m) => `<mark>${m}</mark>`);
    return `${from > 0 ? "…" : ""}${html}…`;
  }

  let active = -1;
  function render(hits, query) {
    active = -1;
    if (hits.length === 0) {
      results.innerHTML = query ? `<p class="no-hits">Nothing for “${escape(query)}”.</p>` : "";
      results.hidden = !query;
      return;
    }
    const term = query.toLowerCase().split(/\s+/)[0];
    results.innerHTML = hits.map((h, i) => `<a href="${base}${h.page.u}" data-i="${i}"><b>${escape(h.page.t)}</b><span class="where">${escape(h.page.s)}</span><span class="snip">${snippet(h.page, h.at, term)}</span></a>`).join("");
    results.hidden = false;
  }

  const run = () => {
    const q = box.value.trim();
    if (!q) { results.hidden = true; results.innerHTML = ""; return; }
    if (!index) { load().then(run); return; }
    render(search(q), q);
  };

  box.addEventListener("focus", load, { once: true });
  box.addEventListener("input", run);
  box.addEventListener("keydown", (e) => {
    const items = [...results.querySelectorAll("a")];
    if (e.key === "Escape") { box.value = ""; results.hidden = true; box.blur(); return; }
    if (items.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      for (const [i, el] of items.entries()) el.classList.toggle("on", i === active);
      items[active].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      items[active].click();
    }
  });
  document.addEventListener("click", (e) => { if (!results.contains(e.target) && e.target !== box) results.hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "")) { e.preventDefault(); box.focus(); }
  });
})();
