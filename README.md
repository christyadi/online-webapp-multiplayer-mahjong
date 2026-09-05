# Mahjong Together

Mahjong Together is a private, casual four-seat web game using documented Chinese house rules. One to four friends can join by invite link; bots fill the remaining seats when a hand starts.

## Requirements

- Node.js 24.20.0
- npm 11.19.0 or the npm version bundled with that Node release

## Commands

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:e2e:all
npm run build
npm start
```

Development serves Vite on `http://localhost:5173` and proxies API and Socket.IO traffic to the server on port 3001. Production uses one Express/Socket.IO process to serve the built site and multiplayer connections.

`test:e2e` runs the current Chromium development gate. `test:e2e:all` is the final Chromium, Firefox, and WebKit gate; Firefox is temporarily deferred because the newest downloaded patched build did not start on this Windows host.

See [SPEC.md](./SPEC.md), [RULES.md](./RULES.md), and [DEPLOYMENT.md](./DEPLOYMENT.md).
