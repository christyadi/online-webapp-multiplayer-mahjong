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
npm run test:e2e:claims
npm run test:e2e:kongs
npm run test:e2e:results
npm run test:e2e:wins
npm run test:e2e:phone
npm run test:e2e:tablet
npm run test:e2e:webkit
npm run test:e2e:all
npm run build
npm start
```

Development serves Vite on `http://localhost:5173` and proxies API and Socket.IO traffic to the server on port 3001. Production uses one Express/Socket.IO process to serve the built site and multiplayer connections.

`test:e2e` runs the desktop Chromium gate. The isolated `claims`, `kongs`, `results`, and `wins` suites cover exact Chow choices, an added-Kong upgrade, rematch lifecycle, and the winning result presentation. `test:e2e:phone` uses the exact 390×844 and 844×390 Chromium viewports; `test:e2e:tablet` uses iPad Pro 11 Chromium; and `test:e2e:webkit` is the Safari-engine gate. `test:e2e:all` runs every standard and isolated suite, including Firefox, so it remains intentionally deferred at the user's direction.

See [SPEC.md](./SPEC.md), [RULES.md](./RULES.md), and [DEPLOYMENT.md](./DEPLOYMENT.md).
