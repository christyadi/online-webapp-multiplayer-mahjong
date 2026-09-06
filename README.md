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
npm run test:e2e:results
npm run test:e2e:tablet
npm run test:e2e:webkit
npm run test:e2e:all
npm run build
npm start
```

Development serves Vite on `http://localhost:5173` and proxies API and Socket.IO traffic to the server on port 3001. Production uses one Express/Socket.IO process to serve the built site and multiplayer connections.

`test:e2e` runs the desktop Chromium gate. `test:e2e:results` runs the completed-hand/rematch browser scenario against an isolated test-only server factory. `test:e2e:tablet` runs the iPad Pro 11 viewport with Chromium, and `test:e2e:webkit` runs the Safari-engine gate. `test:e2e:all` includes Firefox too; Firefox is temporarily deferred at the user's direction.

See [SPEC.md](./SPEC.md), [RULES.md](./RULES.md), and [DEPLOYMENT.md](./DEPLOYMENT.md).
