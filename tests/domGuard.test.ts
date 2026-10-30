import { describe, expect, it } from "vitest";
import { guardDom } from "../src/domGuard";

/** Just enough of a DOM node: a parent, children, and the two calls that throw on a stranger. */
class FakeNode {
  parentNode: FakeNode | null = null;
  children: FakeNode[] = [];
  constructor(readonly nodeName: string) {}
  appendChild(n: FakeNode) {
    n.parentNode?.children.splice(n.parentNode.children.indexOf(n), 1);
    this.children.push(n);
    n.parentNode = this;
    return n;
  }
  removeChild(n: FakeNode) {
    const i = this.children.indexOf(n);
    if (i < 0) throw new Error("NotFoundError");
    this.children.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  insertBefore(n: FakeNode, before: FakeNode | null) {
    if (!before) return this.appendChild(n);
    const i = this.children.indexOf(before);
    if (i < 0) throw new Error("NotFoundError");
    n.parentNode?.removeChild(n);
    this.children.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
}

const skips: [string, string][] = [];
guardDom(FakeNode.prototype as unknown as Pick<Node, "removeChild" | "insertBefore">, (call, node) => skips.push([call, node.nodeName]));

/** A span holding one text node, which a translator then wraps in a `<font>`. */
function translated() {
  const span = new FakeNode("SPAN");
  const text = span.appendChild(new FakeNode("#text"));
  const font = new FakeNode("FONT");
  span.insertBefore(font, text);
  font.appendChild(text);
  return { span, text, font };
}

describe("domGuard", () => {
  it("leaves the ordinary calls alone", () => {
    skips.length = 0;
    const parent = new FakeNode("DIV");
    const a = parent.appendChild(new FakeNode("A"));
    const b = parent.insertBefore(new FakeNode("B"), a);
    expect(parent.children.map((n) => n.nodeName)).toEqual(["B", "A"]);
    expect(parent.removeChild(a)).toBe(a);
    expect(parent.children).toEqual([b]);
    expect(skips).toEqual([]);
  });

  it("skips removing a node a translator has moved, and says so", () => {
    skips.length = 0;
    const { span, text, font } = translated();
    expect(() => span.removeChild(text)).not.toThrow();
    expect(font.children).toEqual([text]);
    expect(skips).toEqual([["removeChild", "#text"]]);
  });

  it("skips inserting before a node a translator has moved, and says so", () => {
    skips.length = 0;
    const { span, text } = translated();
    const added = new FakeNode("I");
    expect(span.insertBefore(added, text)).toBe(added);
    expect(added.parentNode).toBeNull();
    expect(skips).toEqual([["insertBefore", "#text"]]);
  });
});
