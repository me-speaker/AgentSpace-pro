// L4.4 — minimal CLI output helpers.
//
// Deliberately small: no chalk, no ora. Just enough to render readable
// tables + JSON for the workflow commands. Kept dependency-free so the
// test repo doesn't need an `npm install` (per MEMORY #22/24).

/** Render a 2D array as a fixed-width table. The first row is treated
 *  as the header. Cells wider than the header are truncated with "…".
 *  Used by the `list`, `show`, and `history` commands. */
export function renderTable(
  headers: string[],
  rows: string[][],
  opts: { truncate?: number } = {},
): string {
  const truncate = opts.truncate ?? 60;
  const widths = headers.map((h, i) => {
    const cellWidths = rows.map((r) => (r[i] ?? "").length);
    return Math.max(h.length, ...cellWidths);
  });
  const lines: string[] = [];
  lines.push(headers.map((h, i) => pad(h, widths[i])).join("  "));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    lines.push(
      row
        .map((cell, i) => pad(truncateCell(cell, truncate), widths[i]))
        .join("  "),
    );
  }
  return lines.join("\n");
}

/** Render a value as a single-line key/value line. Used by `show`. */
export function renderKv(label: string, value: unknown): string {
  return `${label}: ${formatValue(value)}`;
}

/** Format any value as a CLI-friendly string. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Render a list of key/value pairs as a multi-line block. */
export function renderKvBlock(entries: Array<[string, unknown]>): string {
  if (entries.length === 0) return "(empty)";
  const width = Math.max(...entries.map(([k]) => k.length));
  return entries
    .map(([k, v]) => `${k.padEnd(width)}  ${formatValue(v)}`)
    .join("\n");
}

/** Print JSON to stdout. Used by --json flag (not in L4.4 brief but
 *  cheap to include; useful for piping). */
export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function truncateCell(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
}