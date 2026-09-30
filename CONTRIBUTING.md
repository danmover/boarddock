# Contributing to BoardDock

Thanks for helping. Printed-part feedback is the most valuable thing you can send: photos, what broke or
didn't fit, your printer, nozzle, layer height and filament.

## Reporting a board that imports badly

Open an issue with the file (or a zip of the fab outputs), the EDA tool and version, and a screenshot of
what BoardDock shows. If the design is private, a DXF of just the outline plus a list of connectors helps.

## Adding a board to the library

Drop its files and a small `board.json` into `boards/<slug>/` and open a pull request; `boards/README.md` says what to upload and how `npm run boards` turns it into a board the app offers.

## Code

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run typecheck
```

- TypeScript, strict. Keep geometry code free of UI imports; `src/cad/dockplan.ts`, `dockdims.ts` and
  `levels.ts` must stay free of the geometry kernel so the UI can use them on the main thread.
- Units are millimetres. Board frame: X right, Y up, looking at the component side. Panel frame: X right,
  Y up, Z out of the wall. Parts come out in print orientation with a 4x4 matrix to the assembly.
- Every spring change needs a number: extend the FEA cases or the hand checks, and say in the PR what
  moved and why. If a result depends on friction, contact or print quality, say so.
- Add a test for importer fixes (`tests/import.test.ts`) and for new layouts (`tests/panel.test.ts`).

## Releases

Bump the version (`npm version X.Y.Z --no-git-tag-version`), write the notes in `.github/release-notes/vX.Y.Z.md`
(install steps, what's new, known limits; GitHub's list of changes is added after them), then push a tag `vX.Y.Z`.
The release workflow builds the Windows, macOS and Linux installers, attaches them to a GitHub release, and
publishes the web app to GitHub Pages.
