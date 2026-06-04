import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";

export type SortDir = "asc" | "desc" | null;

// ── useTableControls ─────────────────────────────────────────────────────────
// Generic hook: pass your data array, get back filtered + sorted + paginated rows
// plus all the controls needed to drive the UI.
export function useTableControls<T>(data: T[], _columns: unknown[] = []) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page,    setPage]    = useState(1);
  const [perPage, setPerPage] = useState(10);

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir(null); }
    setPage(1);
  };

  const setFilter = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const filtered = useMemo(() => {
    let result = [...data];
    Object.entries(filters).forEach(([key, val]) => {
      if (!val) return;
      result = result.filter(row =>
        String((row as Record<string, unknown>)[key] ?? "").toLowerCase().includes(val.toLowerCase())
      );
    });
    return result;
  }, [data, filters]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const av = String((a as Record<string, unknown>)[sortKey] ?? "");
      const bv = String((b as Record<string, unknown>)[sortKey] ?? "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const rows       = sorted.slice((page - 1) * perPage, page * perPage);

  return {
    rows, total: sorted.length,
    page, setPage,
    perPage, setPerPage,
    totalPages,
    sortKey, sortDir, toggleSort,
    filters, setFilter,
  };
}

// ── SortIcon ─────────────────────────────────────────────────────────────────
export function SortIcon({
  col, sortKey, sortDir,
}: {
  col: string; sortKey: string | null; sortDir: SortDir;
}) {
  if (sortKey !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30 inline ml-1" />;
  if (sortDir === "asc")
    return <ChevronUp   className="h-3 w-3 inline ml-1" style={{ color: "var(--color-primary)" }} />;
  return   <ChevronDown className="h-3 w-3 inline ml-1" style={{ color: "var(--color-primary)" }} />;
}

// ── Pagination ────────────────────────────────────────────────────────────────
export function Pagination({
  page, totalPages, perPage, total, setPage, setPerPage,
}: {
  page: number; totalPages: number; perPage: number; total: number;
  setPage: (p: number) => void; setPerPage: (n: number) => void;
}) {
  // Build page number list with ellipsis
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "...")[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("...");
      acc.push(p);
      return acc;
    }, []);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-sm"
      style={{ borderTop: "1px solid var(--color-table-border)" }}
    >
      {/* Left: record count + rows per page */}
      <div className="flex items-center gap-3" style={{ color: "var(--color-body-text)", opacity: 0.65 }}>
        <span>{total} record{total !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>Rows per page</span>
        <select
          className="field-input py-1 text-xs"
          style={{ width: 56 }}
          value={perPage}
          onChange={e => { setPerPage(+e.target.value); setPage(1); }}
        >
          {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Right: page buttons */}
      <div className="flex items-center gap-0.5">
        <button
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          className="p-1.5 disabled:opacity-25 hover:opacity-60 transition-opacity"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`e${i}`} className="w-8 text-center text-xs opacity-40">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p as number)}
              className="w-8 h-8 text-xs font-semibold transition-colors"
              style={{
                backgroundColor: page === p ? "var(--color-primary)" : "transparent",
                color:           page === p ? "var(--color-hero-text)" : "var(--color-body-text)",
              }}
            >
              {p}
            </button>
          )
        )}

        <button
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
          className="p-1.5 disabled:opacity-25 hover:opacity-60 transition-opacity"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}