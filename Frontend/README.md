# TRS Frontend

React 18, TypeScript, and Vite frontend for the Tournament Registration System.

## Local development

```powershell
npm.cmd install
npm.cmd run dev
```

Development uses the Vite proxy for `/api` and `/uploads`, targeting the local API configured in `vite.config.ts`.

## Verification

```powershell
npm.cmd run test
npm.cmd run lint
npm.cmd run build
```

## Production or UAT build

1. Run `npm.cmd ci` followed by `npm.cmd run build`.
2. Deploy the contents of `dist` to the IIS frontend site.
3. Replace `config.json` in the deployed portal folder with the environment-specific runtime config.

The same frontend build can be used for local, UAT, and production. API routing is controlled by `/config.json` at runtime:

```json
{
  "apiBaseUrl": "https://uat-api-trs.example.com",
  "mockDelayMs": 60
}
```

Use an empty `apiBaseUrl` for local development so `/api` and `/uploads` go through the Vite proxy. Use the public HTTPS API origin for UAT and production, without `/api` at the end. Runtime config is public browser configuration and must never contain secrets.

## IIS requirements

- Install the IIS URL Rewrite module.
- Host the frontend as a dedicated IIS site or application at the portal hostname.
- Keep the generated `web.config` in the root of the deployed `dist` folder. It serves `index.html` for React routes while excluding existing files, `/api`, and `/uploads`.
- Keep the correct environment `config.json` in the root of the deployed portal folder.
- Add the exact frontend origin to `Cors:AllowedOrigins` in the API's production configuration.
- Bind a valid HTTPS certificate to both frontend and API hostnames.

## Deployment smoke check

After deployment, verify:

1. `/` loads normally.
2. Refreshing `/event/{id}`, `/login`, and `/admin` does not return an IIS 404.
3. `/config.json` returns the expected API origin.
4. Browser API requests target the configured API hostname and pass CORS.
5. `/robots.txt` disallows admin, login, and payment-result routes.
6. Admin and payment-result pages contain a `noindex` robots meta value after navigation.

## Program visibility

The program action menu supports Open (O), Closed (CL), and Hidden (H).
Hidden programs remain available to admins but are excluded from public event
responses and reject new public registrations. Restore them explicitly as Open
or Closed. Existing paid finalization and admin-assisted registration remain
eligible for hidden programs, subject to the other registration rules.

Deploy Backend/TRS_Data/Sql/20261124_add_hidden_program_status.sql before the
updated API and frontend. This expands CK_Programs_Status without changing
existing rows. Before rolling back, change any H programs to CL using the admin
action and verify none remain, then restore the old API/frontend and constraint.
If all programs are hidden, the public response has no selectable programs.

## Fixture creation requires Closed
Generate Fixture and raw fixture-state save require program status CL.
O prompts the admin to close registration; H prompts changing to Closed and
explains that the program becomes publicly visible. The backend rechecks status,
including after a stale browser selection. Generation no longer changes status.
Existing score-entry, advancement and result endpoints retain their behaviour.
The generation transaction locks the program through validation and save.

## Payment result messages
Hosted returns distinguish server-confirmed unsuccessful/cancelled attempts,
expired sessions, reconciliation, and unresolved outcomes. Only confirmed
unsuccessful/cancelled attempts offer retry guidance. Stripe cancel/failed URL
parameters describe a return without confirmation; they do not prove no charge.
Processing screens do not promise an email before confirmation.
Provider verification and database status transitions are unchanged.

## Landing events copy
Superadmins can edit Landing Events Label and Landing Events Title in Master
Configuration > Events. The existing configuration API persists eventsLabel and
eventsTitle in SystemConfigs; no migration is required. Missing or blank values
use the original landing text. Values render as plain text, not HTML.

## Non-sport affiliation fields
For non-sport events, public registration and admin participant editing hide the
built-in Club / School / Company field. Team programs retain required Team name.
Sports retain existing requirements. Registration and Excel import accept blank
affiliation for non-sport, non-Team programs; the template column stays compatible.
Hidden values are preserved when editing. Organisers can collect affiliation using
custom fields, whose required-field rules remain independent. No migration is needed.
