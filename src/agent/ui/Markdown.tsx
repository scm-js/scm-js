/**
 * The little Markdown Claude's replies use — paragraphs, headings, lists, code, bold,
 * italics and links — turned into React elements. No HTML from the reply ever reaches the
 * page as markup.
 */
import type { ReactNode } from "react";

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s][^*\n]*\*(?!\w)|(?<![\w_])_[^_\s][^_\n]*_(?![\w_]))/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
      const href = lm?.[2] ?? "";
      out.push(/^https?:\/\//i.test(href) ? <a key={k} href={href} target="_blank" rel="noreferrer noopener">{lm?.[1]}</a> : t);
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="cla-code">{body.join("\n")}</pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { blocks.push(<div key={key} className={`cla-h cla-h${heading[1].length}`}>{inline(heading[2], key)}</div>); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, "");
        const nested = /^\s{2,}/.test(lines[i]);
        items.push(<li key={`${key}-${items.length}`} className={nested ? "cla-nested" : undefined}>{inline(itemText, `${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !lines[i].trimStart().startsWith("```")) para.push(lines[i++]);
    blocks.push(<p key={key}>{para.flatMap((p, n) => (n ? [<br key={`${key}-br${n}`} />, ...inline(p, `${key}-${n}`)] : inline(p, `${key}-${n}`)))}</p>);
  }
  return <div className="cla-md">{blocks}</div>;
}
