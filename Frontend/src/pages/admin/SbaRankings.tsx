/**
 * SbaRankings.tsx — SBA Rankings Management
 *
 * Standalone admin page (mirrors Events/Fixtures structure) with:
 *   • Import SBA Ranking Workbook (.xlsx) with result summary
 *   • Filterable grid: filter by ranking type, search by SBA ID or player name
 *   • Columns: Rank | Ranking Type | Player(s) | Club | SBA ID | Score | Tournaments | Updated
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { FileUp, Loader2, Search, X, ChevronUp, ChevronDown, Users, User } from "lucide-react";
import { apiGetSbaRankings, apiGetSbaRankingTypes, apiImportSbaRankings } from "@/lib/api";
import type { SbaRanking, SbaRankingType } from "@/types/config";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "ranking" | "rankingType" | "accumulatedScore" | "tournaments";
type SortDir = "asc" | "desc";

interface ImportSummary {
  importedRows: number;
  categories: Array<{ rankingType: string; rows: number }>;
  skippedSheets: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString();
}


// ── Toast (inline, same pattern as other admin pages) ─────────────────────────

function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: "ok" | "err" }[]>([]);
  const add = (msg: string, type: "ok" | "err") => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  };
  return { toasts, ok: (m: string) => add(m, "ok"), err: (m: string) => add(m, "err") };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SbaRankings() {
  const [rankings,     setRankings]     = useState<SbaRanking[]>([]);
  const [rankingTypes, setRankingTypes] = useState<SbaRankingType[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [importing,    setImporting]    = useState(false);
  const [summary,      setSummary]      = useState<ImportSummary | null>(null);
  const typesLoaded = useRef(false);

  // Filters
  const [filterType,   setFilterType]   = useState("");
  const [search,       setSearch]       = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("ranking");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const fileRef = useRef<HTMLInputElement>(null);
  const toast   = useToast();

  // ── Data load ───────────────────────────────────────────────────────────────

  const loadRankings = async (type?: string) => {
    setLoading(true);
    const r = await apiGetSbaRankings(type ? { type } : undefined);
    setLoading(false);
    if (r.data)  setRankings(r.data);
    if (r.error) toast.err("Failed to load SBA rankings.");
  };

  // Load ranking types once on mount — separate from rankings to avoid stale closure
  useEffect(() => {
    if (typesLoaded.current) return;
    typesLoaded.current = true;
    apiGetSbaRankingTypes().then(r => { if (r.data) setRankingTypes(r.data); });
    loadRankings();
  }, []);

  // Reload rankings when type filter changes
  useEffect(() => {
    if (!typesLoaded.current) return; // skip the initial mount trigger
    loadRankings(filterType || undefined);
  }, [filterType]);

  // ── Import ──────────────────────────────────────────────────────────────────

  const handleImport = async (file: File | undefined | null) => {
    if (!file) return;
    setImporting(true);
    setSummary(null);
    const r = await apiImportSbaRankings(file);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
    if (r.error) { toast.err(r.error.message); return; }
    setSummary(r.data);
    toast.ok(`Imported ${r.data.importedRows} rows across ${r.data.categories.length} categories.`);
    loadRankings(filterType || undefined);
  };

  // ── Filter + sort ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = rankings;

    if (q) {
      rows = rows.filter(r =>
        r.player1.sbaId.toLowerCase().includes(q) ||
        r.player1.name.toLowerCase().includes(q)  ||
        r.player2?.sbaId?.toLowerCase().includes(q) ||
        r.player2?.name?.toLowerCase().includes(q)
      );
    }

    rows = [...rows].sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "ranking":          av = a.ranking;          bv = b.ranking;          break;
        case "rankingType":      av = a.rankingType;      bv = b.rankingType;      break;
        case "accumulatedScore": av = a.accumulatedScore; bv = b.accumulatedScore; break;
        case "tournaments":      av = a.tournaments;      bv = b.tournaments;      break;
        default:                 av = a.ranking;          bv = b.ranking;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ?  1 : -1;
      return 0;
    });

    return rows;
  }, [rankings, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null :
    sortDir === "asc" ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-10 max-w-screen-xl mx-auto">

      {/* ── Toast stack ── */}
      <div className="fixed top-5 right-5 z-50 space-y-2 pointer-events-none">
        {toast.toasts.map(t => (
          <div key={t.id} className="px-4 py-2.5 text-sm font-medium shadow-lg pointer-events-auto"
            style={{
              backgroundColor: t.type === "ok" ? "var(--color-primary)" : "var(--badge-closed-text, #e53e3e)",
              color: "var(--color-hero-text, #fff)",
              border: "1px solid transparent",
            }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-heading font-bold text-2xl">SBA Rankings</h1>
          <p className="text-sm opacity-50 mt-1">Import workbooks and browse ranking data by type or player.</p>
        </div>

        {/* Import button */}
        <label className={`btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold cursor-pointer select-none ${importing ? "opacity-60 pointer-events-none" : ""}`}>
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {importing ? "Importing…" : "Import XLSX"}
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden" onChange={e => handleImport(e.target.files?.[0])} />
        </label>
      </div>

      {/* ── Import summary card ── */}
      {summary && (
        <div className="mb-6 p-5" style={{ border: "1px solid var(--color-primary)", backgroundColor: "var(--color-row-hover)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--color-primary)" }}>
                Import successful — {fmt(summary.importedRows)} rows imported
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {summary.categories.map(c => (
                  <span key={c.rankingType} className="px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
                    {c.rankingType} ({c.rows})
                  </span>
                ))}
              </div>
              {summary.skippedSheets.length > 0 && (
                <p className="text-xs mt-2 opacity-50">
                  Skipped sheets: {summary.skippedSheets.join(", ")}
                </p>
              )}
            </div>
            <button onClick={() => setSummary(null)} className="opacity-40 hover:opacity-80 mt-0.5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 mb-5">
        {/* Ranking type filter */}
        <div className="relative">
          <select
            className="field-input pr-8 min-w-[220px]"
            value={filterType}
            onChange={e => { setFilterType(e.target.value); setSearch(""); }}
          >
            <option value="">All ranking types</option>
            {rankingTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <input
            className="field-input pr-8 w-full"
            placeholder="Search SBA ID or player name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search ? (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-40 pointer-events-none" />
          )}
        </div>

        {/* Result count */}
        <div className="flex items-center text-sm opacity-50 whitespace-nowrap px-1">
          {loading ? "Loading…" : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "entry" : "entries"}`}
        </div>
      </div>

      {/* ── Grid ── */}
      <div style={{ border: "1px solid var(--color-table-border)", overflowX: "auto" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
              <Th onClick={() => toggleSort("ranking")} sortable>
                Rank <SortIcon k="ranking" />
              </Th>
              <Th onClick={() => toggleSort("rankingType")} sortable>
                Ranking Type <SortIcon k="rankingType" />
              </Th>
              <Th>Player(s)</Th>
              <Th>Date of Birth</Th>
              <Th>SBA ID(s)</Th>
              <Th>Club</Th>
              <Th onClick={() => toggleSort("accumulatedScore")} sortable right>
                Score <SortIcon k="accumulatedScore" />
              </Th>
              <Th onClick={() => toggleSort("tournaments")} sortable right>
                Tourn. <SortIcon k="tournaments" />
              </Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-16 opacity-40">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 opacity-40 text-sm">
                  {rankings.length === 0
                    ? "No rankings imported yet. Use the Import XLSX button to get started."
                    : "No results match your filters."}
                </td>
              </tr>
            ) : filtered.map((r, idx) => {
              const isDoubles = !!r.player2;
              return (
                <tr key={r.id}
                  style={{
                    borderBottom: "1px solid var(--color-table-border)",
                    backgroundColor: idx % 2 === 0 ? "transparent" : "var(--color-row-hover)",
                  }}>

                  {/* Rank */}
                  <td className="px-4 py-3 font-mono font-bold tabular-nums" style={{ width: 64 }}>
                    #{r.ranking}
                  </td>

                  {/* Ranking Type */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      {isDoubles
                        ? <Users className="h-3.5 w-3.5 opacity-50 flex-shrink-0" />
                        : <User  className="h-3.5 w-3.5 opacity-50 flex-shrink-0" />}
                      <span className="text-xs font-medium">{r.rankingType}</span>
                    </span>
                  </td>

                  {/* Player(s) */}
                  <td className="px-4 py-3">
                    {isDoubles ? (
                      <div className="space-y-0.5">
                        <p className="font-medium leading-tight">{r.player1.name}</p>
                        <p className="font-medium leading-tight opacity-70">{r.player2!.name}</p>
                      </div>
                    ) : (
                      <span className="font-medium">{r.player1.name}</span>
                    )}
                  </td>

                  {/* Date of Birth */}
                  <td className="px-4 py-3 text-xs opacity-70 whitespace-nowrap">
                    {isDoubles ? (
                      <div className="space-y-0.5">
                        <p>{r.player1.dob || "—"}</p>
                        <p className="opacity-70">{r.player2!.dob || "—"}</p>
                      </div>
                    ) : (
                      r.player1.dob || "—"
                    )}
                  </td>

                  {/* SBA ID(s) */}
                  <td className="px-4 py-3 font-mono text-xs">
                    {isDoubles ? (
                      <div className="space-y-0.5">
                        <p>{r.player1.sbaId}</p>
                        <p className="opacity-60">{r.player2!.sbaId}</p>
                      </div>
                    ) : (
                      r.player1.sbaId
                    )}
                  </td>

                  {/* Club */}
                  <td className="px-4 py-3 text-xs opacity-70">
                    {isDoubles ? (
                      <div className="space-y-0.5">
                        <p>{r.player1.club || "—"}</p>
                        <p className="opacity-70">{r.player2!.club || "—"}</p>
                      </div>
                    ) : (
                      r.player1.club || "—"
                    )}
                  </td>

                  {/* Score */}
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold"
                    style={{ color: "var(--color-primary)" }}>
                    {fmt(r.accumulatedScore)}
                  </td>

                  {/* Tournaments */}
                  <td className="px-4 py-3 text-right tabular-nums text-xs opacity-70">
                    {r.tournaments}
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <p className="text-xs opacity-40 mt-3 text-right">
          Showing {filtered.length.toLocaleString()} of {rankings.length.toLocaleString()} entries
        </p>
      )}
    </div>
  );
}

// ── Table header cell ─────────────────────────────────────────────────────────

function Th({ children, onClick, sortable, right }: {
  children: React.ReactNode;
  onClick?: () => void;
  sortable?: boolean;
  right?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-3 text-xs font-bold uppercase tracking-wider text-left whitespace-nowrap
        ${sortable ? "cursor-pointer select-none hover:opacity-80" : ""}
        ${right ? "text-right" : ""}`}
      style={{ opacity: 0.6 }}>
      {children}
    </th>
  );
}