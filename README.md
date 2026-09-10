# Mahjong Together

Mahjong Together is a private, casual four-seat web game using documented Chinese house rules. One to four friends can join by invite link; bots fill the remaining seats when a hand starts.

## Requirements

- Node.js 24.20.0
- npm 11.19.0 or the npm version bundled with that Node release

Development serves Vite on `http://localhost:5173` and proxies API and Socket.IO traffic to the server on port 3001. Production uses one Express/Socket.IO process to serve the built site and multiplayer connections.

The interface includes an accessible light/dark mode toggle. It follows the system preference on first use and remembers the player's choice locally; it is fixed on landing, lobby, and recovery screens, and attached to the gameplay HUD during a hand.

