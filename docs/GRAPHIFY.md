# TRS architecture index

Run these commands from this checkout's Git root:

~~~powershell
python tools/graphify_trs.py check
python tools/graphify_trs.py sync
$graph = python tools/graphify_trs.py path
if ($LASTEXITCODE -ne 0) { throw "TRS graph is unavailable" }
graphify query "RegistrationWorkflowService" --graph $graph
graphify query "PaymentFinalizationService" --graph $graph
graphify query "FixtureGenerationService" --graph $graph
~~~

Each TRS checkout owns a separate graph. Always run the helper in the version
being edited. The parent TRS folder is not a repository.

The helper adapts the TLS workflow. It hashes tracked and nonignored untracked
implementation files under Frontend/src and Backend, including local changes.
It indexes TS, TSX, JS, JSX, C# and project files. SQL participates in freshness
checks but requires direct source inspection. Tests, documentation, styling,
dependencies, generated outputs, runtime data, secret configuration and symlinked
inputs are excluded. The graph therefore supplements source inspection.

Graphify 0.9.113 performs local code-only extraction and clustering without model
labels. No external model, watcher, Git hook or background service is used.
The report records extraction/token information; no semantic LLM pass is requested.

Check exits 0 when current, 2 when stale or missing, and 1 on failure.
Sync uses incremental extraction when compatible and exits early if unchanged.
It validates file coverage, extraction stamps, nonempty outputs and edge endpoints,
then checks source freshness again. A Windows lock serializes writers. Two output
generations and an atomically replaced current.json keep the previous publication
available if a refresh fails. Use path rather than hardcoding a generation.
graph.html and GRAPH_REPORT.md sit alongside the returned graph.json.

Inspect RegistrationWorkflowService for registration and capacity rules,
PaymentAttemptService and PaymentFinalizationService for payment completion,
EventsController for program visibility and removal, and FixtureGenerationService
for brackets and advancement. Verify routes, authorization, JSON contracts, SQL
constraints and callback execution directly in source. Missing edges are not
evidence that a dependency is absent.

Recovery: rerun sync after correcting the reported problem. If current.json itself
is damaged, preserve the output directory for diagnosis and regenerate into an
empty graphify-out. Rollback removes this helper, runbook, AGENTS Graphify section,
ignore entry and generated outputs. It requires no application or database change.
