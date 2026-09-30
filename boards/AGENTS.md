# Adding a community board: steps for an AI job

Goal: for each new or changed folder `boards/<slug>/`, a `board.json` that makes `npm run boards -- <slug>` print `result      ok` with no `WARNING` lines (or only ones you explain), and `public/boards/` regenerated and committed. People's background: `boards/README.md`.

Rules

- Never edit, rename or delete the contributor's source files (`.kicad_pcb`, `.xml`, Gerbers, ...). You edit `board.json` and the generated `public/boards/` only.
- Never invent facts. If maker, license or URL are not in the PR text, the folder or its files, leave them out and say so in your comment (the script warns).
- Do not edit `src/` (connectors live in `src/model/library.ts`; a missing one is reported, not added here), and do not run the whole test suite or `npm run collisions`.
- Do not push to `main`. Commit to the PR branch.

Steps

1. **Find the boards.** `git diff --name-only origin/main...HEAD -- boards/` lists what the PR changes. Each direct sub-folder of `boards/` with changes (other than `example-sensor-jtag`) is one board; its folder name is its slug.
2. **Install once.** `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`
3. **Make sure `boards/<slug>/board.json` exists.** If not, create it with `name` (from the file's title or the folder), and `maker`, `url`, `license`, `source` from what the PR or the folder tells you (`README`, `LICENSE`, the PR description). Valid keys and their meaning: `boards/README.md`, section board.json.
4. **Run it.** `npm run boards -- <slug>` and read the report from the top. It lists the outline size, every hole with its role, every connector with its type and how it was identified (`by name`, `by hint`, `NOT IDENTIFIED`), then `ERROR` and `WARNING` lines. Each message says what to write.
5. **Fix, one kind of message at a time, editing only `board.json`:**
   - `ERROR ... Could not read the files`: the folder holds no readable board (a STEP alone, an Allegro `.brd` without KiCad, a broken export). You cannot fix that: stop and say in the PR comment what to upload instead (`boards/README.md`, section What to upload).
   - `ERROR ... matches no part / no hole`, `unknown key`, `unknown connector type`: a typo in `board.json`. The message lists the references, holes or ids that exist: correct it.
   - `WARNING ... "custom" connector`: decide what the part is from its reference, footprint and value in the message. Get the ids with `npm run boards -- --types`. If one fits (a `USB_C_Receptacle` footprint is `usb_c`), add `"parts": { "<ref>": { "type": "<id>" } }`; if many parts share a footprint, one `"footprints": { "<regex>": "<id>" }` does them all. If none fits, write `{ "type": "custom", "note": "<manufacturer part number or footprint>" }` and list it under "Connector library requests" in your final comment (step 9).
   - A connector `by name` whose type is plainly wrong (its footprint is a USB-C receptacle but it says `usb_a`): add the `parts` hint. Add `"angle"` only when the printed edge direction is wrong.
   - `WARNING ... None of the holes is a mounting hole` or the wrong holes marked `mount`: use `"holes": { "use": [[x, y], ...] }` with positions copied from the report (add `, diameter` to add a hole the file lacks). Mounting holes are the ones the board is screwed down by, usually at the corners; not header pins or plug pegs.
   - `WARNING ... outline looks wrong`: compare with the board's stated size in the PR or README; a wrong-layer outline cannot be fixed in `board.json`: say so.
6. **Run again** (step 4). Repeat 5 and 4 until the result is `ok` and no `WARNING` is left that you could act on. At most 5 rounds: then commit what you have and say what remains.
7. **Regenerate everything and check.** `npm run boards` then `npm run boards -- --check` (must say `public/boards is up to date`).
8. **Test.** `npx vitest run tests/boards.test.ts`. It must pass. (`npm run typecheck` only if you touched a `.ts` file, which you should not have.)
9. **Commit and comment.** `git add boards/<slug> public/boards`, commit `Add community board <slug>`; in the commit body list each hint you added and why. Push to the PR branch. Then comment on the PR with the final report (the connector lines and any WARNING), the hints you added, "Connector library requests: <ref>, <footprint>, <value / part number>" for each `custom` one, and anything you could not settle (missing license, unchecked size).

If a step fails in a way this file does not cover, stop and say what happened rather than guessing.
