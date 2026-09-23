/**
 * The generated blocks of a hand-written document: everything between
 * `<!-- generated: KEY -->` and `<!-- /generated -->` is replaced with `blocks.get(KEY)`.
 * The reference documents (`docs/triggers.md`, `docs/chk-format.md`) keep their tables in
 * such blocks so the prose around them stays hand-written.
 */
const BLOCK = /<!-- generated: ([^>]+?) -->\n[\s\S]*?<!-- \/generated -->/g;

/**
 * `missing` lists the blocks the generator has and the document does not (a section or a
 * trigger with no page); `unknown` the markers in the document the generator does not know.
 */
export function fillBlocks(markdown, blocks) {
  const seen = new Set();
  const unknown = [];
  const text = markdown.replace(BLOCK, (whole, key) => {
    const block = blocks.get(key);
    if (block === undefined) {
      unknown.push(key);
      return whole;
    }
    seen.add(key);
    return `<!-- generated: ${key} -->\n${block}\n<!-- /generated -->`;
  });
  return { text, missing: [...blocks.keys()].filter((k) => !seen.has(k)), unknown };
}
