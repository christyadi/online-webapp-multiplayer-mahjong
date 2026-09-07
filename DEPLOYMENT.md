# Deployment

The release target is one Render Free Node web service connected to the new private GitHub repository. It serves the site, API, and Socket.IO from one process; no database, persistent disk, add-on, custom domain, or second service is used.

## Current status

Deployments run from the `deployment` branch through the GitHub Actions **Verify and deploy** workflow. It runs formatting, lint, type checking, unit/integration tests, a production build, and Chromium end-to-end tests before it triggers Render. The workflow does not create or configure a Render service.

## Render settings

- Runtime: Node
- Node version: 24.20.0
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Environment: `NODE_ENV=production` and `APP_ORIGIN` set to the assigned Render HTTPS URL
- Connected branch: `deployment`
- Deploy mode: manual/Off in Render; GitHub Actions triggers deployment only after its verification job succeeds
- Region: Frankfurt when offered for Free services, otherwise the provider default

Before creation, verify that the account's spending controls guarantee no billable overage without changing unrelated services. The public URL and exact redeployment/stop instructions will be added only after real deployment; they will not be invented.

## GitHub Actions deployment secret

After the Render service exists, copy its deploy hook URL from **Settings** and save it as the GitHub repository Actions secret `RENDER_DEPLOY_HOOK_URL`. The URL is a credential and must never be committed. Pushing to `deployment` then runs the verification job and sends one POST request to that secret URL only when every check passes.

Free-tier startup delays, quotas, and interrupted availability are accepted. All guest sessions and game rooms are in memory, so a server restart ends active games.

## Build dependency note

Keep `NODE_ENV=production` for the service, but include development dependencies in the build command. The shared package, Vite web bundle, and server TypeScript compilation use the repository's TypeScript toolchain and declaration packages (including `@types/express`), which npm otherwise omits when `NODE_ENV=production` is set. If the Render dashboard has a manually entered command, replace `npm ci; npm run build` or `npm ci && npm run build` with `npm ci --include=dev && npm run build`.
