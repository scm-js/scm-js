/**
 * The Preferences dialog's filter box: what it matches and how.
 *
 * There is no list of keywords. A section of a built-in page matches on the text it
 * renders — its heading, labels, the options of its selects and its hints, read off the
 * DOM by `filterSections` — so a label edited or a section added later is found with no
 * second place to change. The Hotkeys page is matched row by row on the same strings its
 * rows show (`hotkeyRowMatches`), since one section there would be the whole list.
 */

/** Text as the filter compares it: one composition of Hangul, lower case, one kind of minus. */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/−/g, "-");
}

/** The words of the box, folded; none for an empty or blank box. */
export function filterTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** Whether every word of `query` is somewhere in `text`, whatever its case. A blank query matches. */
export function textMatches(text: string, query: string): boolean {
  const hay = fold(text);
  return filterTerms(query).every((term) => hay.includes(term));
}

/**
 * Whether a key as the Hotkeys page shows it ("Ctrl+Shift+S") is the one the query names:
 * the whole key, or its start up to a "+" — "Ctrl" or "Ctrl+Shift" find every key that
 * begins so, while "Ctrl+S" finds Ctrl+S and not Ctrl+Shift+S. Spaces in the query are
 * ignored ("ctrl + s").
 */
export function keyMatches(key: string, query: string): boolean {
  const q = fold(query).replace(/\s+/g, "");
  if (!q) return false;
  const k = fold(key);
  return k.startsWith(q) && (k.length === q.length || q.endsWith("+") || k[q.length] === "+");
}

/** A row of the Hotkeys page: its command's name holds every word of the query, or one of its keys is the one asked for. */
export function hotkeyRowMatches(name: string, keys: readonly string[], query: string): boolean {
  if (filterTerms(query).length === 0) return true;
  return textMatches(name, query) || keys.some((k) => keyMatches(k, query));
}

/**
 * An element's text as the filter reads it: every text node, hidden or not (the options of
 * a closed select, the inside of a closed `<details>`), with a space between nodes so a
 * heading and the label under it do not run together.
 */
export function renderedText(el: Element): string {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue) parts.push(n.nodeValue);
  return parts.join(" ");
}

/**
 * Show, in the rendered results, the sections (`.prefs-section`) whose text matches and hide
 * the rest; open a `<details>` whose inside matches, so the match is in sight; hide a page's
 * group (`[data-results-page]`) with nothing left in it. A row the dialog filtered itself
 * (`[data-result-row]`: a plugin's page, a test target, hotkey rows) counts as something
 * left. Returns whether anything is showing.
 */
export function filterSections(root: Element, query: string): boolean {
  let any = false;
  for (const group of root.querySelectorAll<HTMLElement>("[data-results-page]")) {
    let shown = group.querySelector("[data-result-row]") !== null;
    for (const section of group.querySelectorAll<HTMLElement>(".prefs-section")) {
      const match = textMatches(renderedText(section), query);
      section.hidden = !match;
      if (!match) continue;
      shown = true;
      for (const details of section.querySelectorAll("details")) if (!details.open && textMatches(renderedText(details), query)) details.open = true;
    }
    group.hidden = !shown;
    any ||= shown;
  }
  return any;
}
