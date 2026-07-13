/**
 * SbaRankings.tsx - SBA Rankings Management
 *
 * Standalone admin page (mirrors Events/Fixtures structure) with:
 *  - Import SBA Ranking Workbook (.xlsx) with result summary
 *  - Filterable grid: filter by ranking type, search by SBA ID or player name
 *  - Columns: Rank | Ranking Type | Player(s) | Club | SBA ID | Score | Tournaments | Updated
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { FileUp, Loader2, Search, X, ChevronUp, ChevronDown, Users, User } from "lucide-react";
import { apiGetSbaRankings, apiGetSbaRankingTypes, apiImportSbaRankings } from "@/lib/api";
import type { SbaRanking, SbaRankingType } from "@/types/config";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";

//  Types

type SortKey = "ranking" | "rankingType" | "accumulatedScore" | "tournaments";
type SortDir = "asc" | "desc";

interface ImportSummary {
  importedRows: number;
  categories: Array<{ rankingType: string; rows: number }>;
  addedClubs: number;
  addedClubNames: string[];
  skippedSheets: string[];
}

//  Helpers

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtDateTime(value?: string) {
  if (!value) return "Not imported yet";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "Not imported yet";
  return dt.toLocaleString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


//  Toast (inline, same pattern as other admin pages)

//  Page

export default function SbaRankings() {
  const [rankings,     setRankings]     = useState<SbaRanking[]>([]);
  const [rankingTypes, setRankingTypes] = useState<SbaRankingType[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [importing,    setImporting]    = useState(false);
  const [summary,      setSummary]      = useState<ImportSummary | null>(null);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });
  const typesLoaded = useRef(false);

  // Filters
  const [filterType,   setFilterType]   = useState("");
  const [search,       setSearch]       = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("ranking");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const fileRef = useRef<HTMLInputElement>(null);
  const showFeedback = (variant: ActionFeedbackVariant, title: string, description?: string) =>
    setFeedback({ open: true, variant, title, description });

  //  Data load

  const loadRankings = async (type?: string) => {
    setLoading(true);
    const r = await apiGetSbaRankings(type ? { type } : undefined);
    setLoading(false);
    if (r.data)  setRankings(r.data);
    if (r.error) showFeedback("error", "Failed to load SBA rankings", r.error.message);
  };

  // Load ranking types once on mount - separate from rankings to avoid stale closure
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

  //  Import

  const handleImport = async (file: File | undefined | null) => {
    if (!file) return;
    setImporting(true);
    setSummary(null);
    const r = await apiImportSbaRankings(file);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
    if (r.error) { showFeedback("error", "Import failed", r.error.message); return; }
    setSummary(r.data);
    showFeedback("success", "Import completed", `Replaced list with ${r.data.importedRows} rows and added ${r.data.addedClubs} clubs.`);
    loadRankings(filterType || undefined);
  };

  //  Filter + sort

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

  const latestUpdatedAt = useMemo(() => {
    return rankings
      .map(r => r.updatedAt)
      .filter((value): value is string => !!value)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  }, [rankings]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null :
    sortDir === "asc" ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;

  //  Render

  return (
    <div>

  {/*  Toast stack  */}
      <ActionFeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        description={feedback.description}
        onOpenChange={open => setFeedback(prev => ({ ...prev, open }))}
      />

  {/*  Header  */}
      <div className="flex items-center justify-between mb-8">
          <div className="admin-page-title" style={{ marginBottom: 0 }}>
            <h1>SBA Rankings</h1>
          </div>
        <label className={`btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold cursor-pointer select-none ${importing ? "opacity-60 pointer-events-none" : ""}`}>
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {importing ? "Importing..." : "Import XLSX"}
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden" onChange={e => handleImport(e.target.files?.[0])} />
        </label>
      </div>

  {/*  Import summary card  */}
      {summary && (
        <div className="mb-6 p-5" style={{ border: "1px solid var(--color-primary)", backgroundColor: "var(--color-row-hover)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--color-primary)" }}>
                Import successful - {fmt(summary.importedRows)} rows imported as a fresh list
              </p>
              <p className="text-xs mt-1 opacity-60">
                {summary.addedClubs > 0
                  ? `${summary.addedClubs} new club${summary.addedClubs === 1 ? "" : "s"} added to the master list.`
                  : "No new clubs were added to the master list."}
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
              {summary.addedClubNames.length > 0 && (
                <p className="text-xs mt-2 opacity-50">
                  Added clubs: {summary.addedClubNames.join(", ")}
                </p>
              )}
            </div>
            <button onClick={() => setSummary(null)} className="opacity-40 hover:opacity-80 mt-0.5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

  {/*  Filters  */}
      <div className="p-5 mb-6" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
        <div className="grid grid-cols-1 md:flex md:flex-wrap items-end gap-4">
  {/* Ranking type filter */}
        <FG label="Ranking Type">
          <select
            className="field-input w-full md:w-56"
            value={filterType}
            onChange={e => { setFilterType(e.target.value); setSearch(""); }}
          >
            <option value="">All ranking types</option>
            {rankingTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </FG>

  {/* Search */}
        <FG label="Search">
        <div className="relative w-full md:w-80">
          <input
            className="field-input with-right-icon w-full"
            placeholder="Search SBA ID or player name..."
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
        </FG>

  {/* Result count */}
        <div className="flex items-center text-sm opacity-50 whitespace-nowrap px-1 pb-2">
          {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</span> : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "entry" : "entries"}`}
        </div>
        </div>
      </div>

  {/*  Grid  */}
      <div className="hidden md:block overflow-x-auto" style={{ border: "1px solid var(--color-table-border)" }}>
        <table className="trs-table w-full">
          <thead>
            <tr>
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
            ) : filtered.map((r) => {
              const isDoubles = !!r.player2;
              return (
                <tr key={r.id}>

  {/* Rank */}
                  <td className="font-mono font-bold tabular-nums" style={{ width: 64 }}>
                    #{r.ranking}
                  </td>

  {/* Ranking Type */}
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      {isDoubles
                        ? <Users className="h-3.5 w-3.5 opacity-50 flex-shrink-0" />
                        : <User  className="h-3.5 w-3.5 opacity-50 flex-shrink-0" />}
                      <span className="text-xs font-medium">{r.rankingType}</span>
                    </span>
                  </td>

  {/* Player(s) */}
                  <td>
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
                  <td className="text-xs opacity-70 whitespace-nowrap">
                    {isDoubles ? (
                      <div className="space-y-0.5">
                        <p>{r.player1.dob || "-"}</p>
                        <p className="opacity-70">{r.player2!.dob || "-"}</p>
                      </div>
                    ) : (
                      r.player1.dob || "-"
                    )}
                  </td>

  {/* SBA ID(s) */}
                  <td className="font-mono text-xs">
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
                  <td className="text-xs opacity-70">
                    {isDoubles ? (
                      <div className="space-y-0.5">
                        <p>{r.player1.club || "-"}</p>
                        <p className="opacity-70">{r.player2!.club || "-"}</p>
                      </div>
                    ) : (
                      r.player1.club || "-"
                    )}
                  </td>

  {/* Score */}
                  <td className="text-right font-mono tabular-nums font-semibold"
                    style={{ color: "var(--color-primary)" }}>
                    {fmt(r.accumulatedScore)}
                  </td>

  {/* Tournaments */}
                  <td className="text-right tabular-nums text-xs opacity-70">
                    {r.tournaments}
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-16 opacity-40" style={{ border: "1px solid var(--color-table-border)" }}>
            <Loader2 className="h-5 w-5 animate-spin inline" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 opacity-40 text-sm" style={{ border: "1px solid var(--color-table-border)" }}>
            {rankings.length === 0
              ? "No rankings imported yet. Use the Import XLSX button to get started."
              : "No results match your filters."}
          </div>
        ) : filtered.map(r => {
          const isDoubles = !!r.player2;
          return (
            <div key={r.id} className="p-4" style={{ border: "1px solid var(--color-table-border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono font-bold text-sm">#{r.ranking}</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium">
                    {isDoubles
                      ? <Users className="h-3.5 w-3.5 opacity-50 flex-shrink-0" />
                      : <User  className="h-3.5 w-3.5 opacity-50 flex-shrink-0" />}
                    {r.rankingType}
                  </p>
                </div>
                <p className="font-mono text-sm font-semibold text-right" style={{ color: "var(--color-primary)" }}>
                  {fmt(r.accumulatedScore)}
                  <span className="block text-xs opacity-60">{r.tournaments} tourn.</span>
                </p>
              </div>
              <div className="mt-3 space-y-2">
                <div>
                  <p className="text-xs opacity-50">Player(s)</p>
                  <p className="text-sm font-medium">{r.player1.name}</p>
                  {r.player2 && <p className="text-sm font-medium opacity-70">{r.player2.name}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="opacity-50">SBA ID</p>
                    <p className="font-mono">{r.player1.sbaId}</p>
                    {r.player2 && <p className="font-mono opacity-60">{r.player2.sbaId}</p>}
                  </div>
                  <div>
                    <p className="opacity-50">DOB</p>
                    <p>{r.player1.dob || "-"}</p>
                    {r.player2 && <p className="opacity-70">{r.player2.dob || "-"}</p>}
                  </div>
                </div>
                <div className="text-xs opacity-70">
                  <p className="opacity-50">Club</p>
                  <p>{r.player1.club || "-"}</p>
                  {r.player2 && <p className="opacity-70">{r.player2.club || "-"}</p>}
                </div>
              </div>
            </div>
          );
        })}
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

//  Table header cell

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

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 opacity-60">{label}</label>
      {children}
    </div>
  );
}
