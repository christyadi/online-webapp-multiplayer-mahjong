# Deployment

The release target is one Render Free Node web service connected to the new private GitHub repository. It serves the site, API, and Socket.IO from one process; no database, persistent disk, add-on, custom domain, or second service is used.

## Current status

Deployment is intentionally deferred while the visual-design direction and implementation plan are completed. The user will manually configure Render afterward. This document preserves the required settings; do not create a service, request provider access, or claim public verification during the refinement phase.

## Render settings

- Runtime: Node
- Node version: 24.20.0
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Environment: `NODE_ENV=production` and `APP_ORIGIN` set to the assigned Render HTTPS URL
- Deploy mode after initial release: manual; automatic deployments disabled
- Region: Frankfurt when offered for Free services, otherwise the provider default

Before creation, verify that the account's spending controls guarantee no billable overage without changing unrelated services. The public URL and exact redeployment/stop instructions will be added only after real deployment; they will not be invented.

Free-tier startup delays, quotas, and interrupted availability are accepted. All guest sessions and game rooms are in memory, so a server restart ends active games.

## Build dependency note

Keep `NODE_ENV=production` for the service, but include development dependencies in the build command. The shared package, Vite web bundle, and server TypeScript compilation use the repository's TypeScript toolchain and declaration packages (including `@types/express`), which npm otherwise omits when `NODE_ENV=production` is set. If the Render dashboard has a manually entered command, replace `npm ci; npm run build` or `npm ci && npm run build` with `npm ci --include=dev && npm run build`.
