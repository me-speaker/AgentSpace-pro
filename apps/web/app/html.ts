// L4.3 — minimal hyperscript-style tree builder.
//
// Why this exists instead of real JSX:
//   - The test repo doesn't have `react` or `next` installed (per
//     MEMORY #22/24 — `npm install` would clobber the manual
//     node_modules/@agent-space/* symlinks).
//   - L4.3's brief says "不跑 next dev" — so the pages must be
//     scaffolded, not deployed.
//   - To still get meaningful tests (link hrefs, table rows, content)
//     we represent the React element tree as a plain `{tag, props,
//     children}` object (the same shape React.createElement returns).
//   - In prod, a one-line swap to real JSX would be possible: replace
//     `h('a', { href }, [text])` with `<a href={href}>{text}</a>`.
//
// The shape is intentionally compatible with React element inspection
// (React DevTools uses the same `{ $$typeof, type, props, key }` shape).
// We use a sentinel `_isH = true` so test assertions can distinguish
// our tree from plain objects.

export interface HNode {
  _isH: true;
  tag: string;
  props: Record<string, unknown>;
  children: Array<HNode | string>;
}

export function h(
  tag: string,
  props: Record<string, unknown> = {},
  children: Array<HNode | string> = [],
): HNode {
  return {
    _isH: true,
    tag,
    props: { ...props },
    children,
  };
}

/** Recursively render an HNode tree to an HTML string (for snapshot
 *  tests + dev preview). Not used by Next.js — that's what JSX is for
 *  in prod. */
export function toHtml(node: HNode | string, depth = 0): string {
  if (typeof node === "string") return escapeHtml(node);
  const props = Object.entries(node.props)
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeAttr(String(v))}"`))
    .join("");
  if (node.children.length === 0) {
    return `<${node.tag}${props} />`;
  }
  const inner = node.children
    .map((c) => toHtml(c, depth + 1))
    .join("");
  return `<${node.tag}${props}>${inner}</${node.tag}>`;
}

/** Walk the tree and collect nodes that match the predicate. Useful
 *  for test assertions like "find all anchor tags". */
export function findAll(
  root: HNode | string,
  predicate: (n: HNode) => boolean,
): HNode[] {
  const out: HNode[] = [];
  walk(root, (n) => {
    if (predicate(n)) out.push(n);
  });
  return out;
}

export function walk(
  node: HNode | string,
  visit: (n: HNode) => void,
): void {
  if (typeof node === "string") return;
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/** Extract the first text node under a parent (recursively). Returns
 *  empty string if no text descendant exists. */
export function textContent(node: HNode | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textContent).join("");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}