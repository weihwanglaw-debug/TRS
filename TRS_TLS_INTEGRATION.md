# TRS–TLS live scores and public results

## Responsibilities and result priority

TRS exports event setup. TLS operates its draw, schedule and scoring. TLS publishes spectator snapshots; receiving a snapshot never creates or changes a TRS fixture, participant, registration or payment.

For each program, public results use TRS whenever an existing TRS fixture has a completed/walkover result, or a completed heat. Automatic BYEs and unscored fixtures alone do not trigger this priority. Otherwise the latest accepted TLS result snapshot is used. Sources are never mixed within a program view. Removing all recorded TRS results makes the stored TLS snapshot visible again.

TRS must have no fixtures for the event before transfer; registration must be closed. These checks happen at export and TLS import. There is no transfer acknowledgement, ownership lock or post-transfer fixture restriction; the organiser is responsible for choosing where to operate the event.

## Setup and deployment

1. Apply `Backend/TRS_Data/Sql/20261103_create_tls_snapshots.sql` to the TRS database before deploying the new application. The idempotent script adds only `TlsLiveSnapshots` and `TlsResultSnapshots`. Existing business tables/data are unchanged.
2. Configure a different, random API key of at least 32 printable characters for each authorised event, using server configuration, for example environment variable `TlsIntegration__Events__123__ApiKey`. Never commit credentials. Requests authenticate with `X-TLS-Key`; a key for one event cannot publish to another.
3. Set `TlsIntegration__SourceSystemId` to a stable identity for this TRS installation. Its default is `TRS`; installations sharing a TLS database must use distinct identities.
4. TLS can fetch eligible events directly using its server settings `Trs__ApiBaseUrl` (origin, e.g. `https://trs.example`) and `Trs__AccessToken` (an existing authorised TRS administrator JWT). Renew the token when it expires. Existing transfer-file import remains available.
5. In TLS Event Settings → TRS Publishing, enter:
   - Live URL: `https://trs.example/api/tls/events/123/live`
   - Results URL: `https://trs.example/api/tls/events/123/programs/{programId}/results`
   - The event API key and live interval (2–120 seconds; default 5).
   - Enable and save publishing.

TLS stores the credential encrypted through ASP.NET Data Protection. Keep the TLS service account's Data Protection key ring across deployments; changing the account/removing its key ring requires entering the credential again. Public responses never contain that credential. Export authentication uses existing TRS roles; payment and registration authentication are unchanged.

Use HTTPS outside the local development network. Publishing URLs are organiser-controlled outbound destinations; redirects are disabled so credentials are not forwarded to another host.

## APIs

| Method and path | Purpose |
|---|---|
| GET `/api/tls-export/events` | Authenticated eligible event list: closed registration, no fixtures |
| GET `/api/tls-export/events/{eventId}` | Authenticated schema-2 setup transfer; rechecks eligibility |
| PUT `/api/tls/events/{eventId}/live` | Event-scoped complete current live snapshot; `X-TLS-Key` |
| PUT `/api/tls/events/{eventId}/programs/{programId}/results` | Complete confirmed program results; `X-TLS-Key` |
| GET `/api/events/live-status` | Event IDs with nonempty live snapshots, for landing badges |
| GET `/api/events/{eventId}/score-availability` | Current live availability and programs with viewable TRS/TLS results |
| GET `/api/events/{eventId}/live` | Public current matches, refresh interval and last receipt |
| GET `/api/events/{eventId}/results?programId={programId}` | Public programs and TRS-first results |

Setup transfer is version 2. Event/program source IDs are `event:123` and `program:456`. TLS retains local readable IDs plus original mappings, and publishes the numeric original IDs. Repeated players with the same normalized name and DOB are represented once in the export, using the earliest participant identity, with all program entries referencing that person. This affects only the transfer representation.

## Snapshot schema (version 1)

Both receiving endpoints accept this envelope; live requests use `programId: null` and contain every currently playing/awaiting-confirmation match in the event. Results contain every confirmed result across the program's rounds.

```json
{
  "schemaVersion": 1,
  "eventId": 123,
  "eventName": "Badminton Open",
  "programId": 456,
  "programName": "Men's Singles",
  "version": 1793685600000001,
  "generatedAt": "2026-11-03T06:00:00Z",
  "timeZone": "Asia/Singapore",
  "refreshSeconds": 5,
  "matches": [{
    "id": "EV000001-P001-M0001",
    "programId": 456,
    "programName": "Men's Singles",
    "phase": "G",
    "round": 1,
    "roundLabel": "Group Stage",
    "group": "Group A",
    "team1": { "id": "entry:10", "name": "Player A", "players": ["Player A"], "seed": null },
    "team2": { "id": "entry:11", "name": "Player B", "players": ["Player B"], "seed": null },
    "games": [{ "a": 21, "b": 18 }, { "a": 21, "b": 19 }],
    "winner": "A",
    "outcome": "N",
    "remark": "",
    "matchDate": "2026-11-03",
    "startTime": "14:00",
    "endTime": "14:40",
    "court": "1",
    "status": "C",
    "scoreA": null,
    "scoreB": null,
    "serverSide": null
  }]
}
```

- Match and entry references describe snapshot content; they are not reconciled against TRS fixture/entry records. Doubles list both players.
- Phase codes: `G` group, `K` knockout. Winner/serving side: `A` or `B`.
- Results: `C` completed, `W` walkover, `BY` automatic BYE. Live: `IP` playing, `RC` awaiting organiser confirmation, with current integer scores.
- Outcomes: `N` normal, `WO` walkover, `BY` BYE. Other outcome codes are retained, with a readable remark (e.g. `R` retirement, `D` disqualification, `M` admin decision). Partial exceptional scores are preserved.
- Dates use `yyyy-MM-dd`, match times `HH:mm` or `HH:mm:ss` in the supplied venue timezone. Generated/received timestamps include UTC offsets.
- TRS explicitly maps supported fields. Unknown optional properties are ignored and not echoed publicly. Invalid required fields, unknown programs, or programs from another event reject the entire snapshot.
- Requests are limited to 5 MB and 10000 matches. Replacement is atomic under a SQL transaction.

## Delivery and recovery

Versions increase independently per event/live stream and per program/results stream. TLS reserves them in existing durable ID counters; restart does not reset them. TRS accepts only newer versions; duplicate/older requests return success with `accepted: false` and the current version, without changing data or receipt time.

Successful new snapshots replace only the named event/program. An empty live list clears that event's live scores and updates its last-received time. An explicit newer empty result list clears only that program's received TLS results. Neither clears TRS fixtures/manual results.

TLS sends live snapshots periodically and attempts an immediate empty publication when no live matches remain. Confirmed-result changes are detected and publish a full program snapshot. A failed result send is not queued or repeatedly retried automatically; use TLS dashboard Retry Publishing or Event Settings Resend Results / Live Scores. Startup republishes the current state for enabled events. Alerts are cleared after successful sends; alert history is not persisted.

Public live data has no expiry rule and no delayed-update label. Failed requests retain previous data/timestamp, so an interrupted final empty send can leave an old LIVE badge visible until TLS publishes successfully again. An empty snapshot means nothing playing now, including during breaks; it does not declare the event finished.

## Public navigation

- Event card LIVE badge → `/event/{eventId}/live` (all playing programs, no day/program filters).
- Event Information → View Live Scores, shown only when the event has current live matches.
- Program card → View Results → `/event/{eventId}/results?program={programId}`, shown only when that program has viewable results. Unscored TRS fixtures alone do not enable it. Availability refreshes using the live snapshot interval (5 seconds before a snapshot exists); links stay hidden until a successful check.
- Results have a program dropdown and round tabs, including Group Stage. The same read-only match component displays both result sources and live player-aligned scores.
- Viewing pages use the public landing theme and reserve space below the fixed header for Back to Event. Direct links remain valid when the data becomes empty.
- The live page shows Last fetched (the browser's last successful TRS fetch) and Last received from TLS (the stored TRS receipt timestamp), using the configured display timezone/date-time format. Score content refreshes every configured X seconds. Fetch failure preserves scores, both successful timestamps and the previous interval; leaving the page cancels polling.

## Verification and rollback

Focused tests cover validation, source priority, SQL replacement/version isolation, migration-script repeatability, public navigation/polling, and TLS HTTP failure/recovery/restarts using disposable databases. `TRS_SNAPSHOT_TEST_CONNECTION` enables the SQL test, which creates and drops a UUID-named `TRS_SnapshotTest_*` database; it never modifies the supplied database.

Build both backends/frontends. Run TRS `dotnet test Backend/TRS.Tests/TRS.Tests.csproj` and frontend tests; run TLS `python tests/trs_publishing_integration.py` and its existing frontend workflow harness.

Rollback: disable TLS publishing, restore the previous applications and retain the new snapshot tables. No existing results need conversion or restoration. Before applying database changes in another environment, take the normal database backup. Removing snapshot tables/data is a separate destructive operation requiring approval.
