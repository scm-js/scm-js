/**
 * Keep a page translator from taking the editor down.
 *
 * Chrome's and Edge's translators (and Safari's, and some extensions) replace the text
 * nodes React put in the page with their own — Chrome wraps each in `<font>`. React still
 * holds the old nodes, and the next time it removes one, or inserts beside one, the DOM
 * throws `NotFoundError` because the node is no longer where React left it
 * (facebook/react#11538). That is a commit-phase error: the panel or menu it happened in
 * falls to its error boundary, for no fault of the editor's. 0.8.3's error counts were
 * these — panels changing with the layer, a menu's check mark.
 *
 * So the two calls step aside instead of throwing when the node they are asked about has a
 * different parent: removing a node that is already somewhere else does nothing, and
 * inserting before one that has moved does nothing either (the translator's copy is what
 * is on screen). Each time it happens it is logged as a warning, since the same mismatch
 * from the editor's own code would be a bug worth seeing. It is the workaround from that
 * React issue; translation keeps working, which `translate="no"` would not.
 *
 * Imported by `main.tsx` before anything renders.
 */
import { logWarn } from "./editor/log";
import { pageTranslated } from "./services/usage";

type Skipped = (call: "removeChild" | "insertBefore", node: Node) => void;

/** Install the guard on `proto` (`Node.prototype`, or a stand-in for the tests). */
export function guardDom(proto: Pick<Node, "removeChild" | "insertBefore">, skipped: Skipped): void {
  const removeChild = proto.removeChild;
  const insertBefore = proto.insertBefore;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      skipped("removeChild", child);
      return child;
    }
    return removeChild.call(this, child) as T;
  };
  proto.insertBefore = function <T extends Node>(this: Node, node: T, before: Node | null): T {
    if (before && before.parentNode !== this) {
      skipped("insertBefore", before);
      return node;
    }
    return insertBefore.call(this, node, before) as T;
  };
}

if (typeof Node !== "undefined") {
  guardDom(Node.prototype, (call, node) =>
    logWarn("app", "A node had moved before the editor could update it; skipped", { call, node: node.nodeName, translated: pageTranslated() }));
}
