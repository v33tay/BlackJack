# BlackJack

Browser-based blackjack for a group of friends: a framework-free Node.js server and a vanilla JavaScript client synchronized over WebSocket. It is meant for a local network — no accounts and no database.

[Русская версия](README.md)

This is a short English overview. The detailed rules, WebSocket protocol, architecture and TODO are maintained in Russian under [`docs/`](docs/).

## Features

- up to 6 players at one table sharing a 6-deck shoe
- self-running tables: no host and no start button
- a betting window with +10/+25/+50 chips, a ready button and a zero default bet
- hit, stand, double down and split; automatic dealer that reveals cards step by step
- the server is the single source of truth for bets, turns and payouts
- seat recovery by token, leaving, rebuy and auto-stand for disconnected players
- three bot strategies; the table creator adds and removes bots between rounds
- safe shoe exhaustion, protection against duplicate actions, Windows and Linux support

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:3000`. Node.js 18 or newer is required. Platform scripts in `scripts/` install dependencies automatically.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | start the server |
| `npm run dev` | start with file watching |
| `npm test` | run all tests |
| `npm run test:coverage` | tests with coverage thresholds |
| `npm run lint` | ESLint |

## Documentation

- [Table rules](docs/rules.md) (Russian)
- [WebSocket protocol](docs/protocol.md) (Russian)
- [Architecture](docs/architecture.md) (Russian)
- [Interface mockups](docs/mockups/) (Russian)
- [Changelog](CHANGELOG.md)

## Limitations

- tables and balances live in process memory and are lost on restart
- designed for a trusted local network; use HTTPS/WSS plus `ALLOWED_ORIGINS` in public deployments
- no insurance, surrender or re-split
- the seat token is a bearer token: whoever learns it can take the seat

---

© 2026
