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
