# BoardDock

TypeScript, React, three.js, manifold-3d; a web app and an Electron app. Units are millimetres. See `CONTRIBUTING.md` for the conventions.

- `npm run typecheck`, `npm test` (`npx vitest run tests/<file>` for one file), `npm run dev`.
- Adding a community board (a PR that puts files under `boards/<slug>/`): follow `boards/AGENTS.md`, exact steps with the commands. People's guide: `boards/README.md`.
- Teaching the app a connector (a part number or footprint name it reports `NOT IDENTIFIED`, or a whole new connector type for the toolbox): a PR that puts a JSON file under `parts/` (`names-*.json`, `type-<id>.json`): follow `parts/AGENTS.md`, exact steps with the commands (`npm run parts`). People's guide: `parts/README.md`.
