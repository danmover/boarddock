# Adding contributed parts: steps for an AI job

Goal: teach BoardDock a connector it does not recognise: a `parts/names-*.json` (part numbers or footprint names that mean an existing connector type) or a `parts/type-<id>.json` (a new type), so that `npm run parts` says `0 errors` with no `WARNING` you could act on, `src/model/parts.json` is regenerated and committed, and the tests pass. People's background: `parts/README.md` (formats, every key, the rules).

Typical trigger: a board report (`npm run boards`, see `boards/AGENTS.md`) says `J7  custom  ... NOT IDENTIFIED  <footprint>`, or a pull request changes `parts/`. Example: the report says J7 is NOT IDENTIFIED with footprint `ACME_ETHJ_77X`, and its picture or datasheet (in the PR text) says it is an RJ45 jack: add `ACME_ETHJ_77X` to `parts/names-acme.json` with type `rj45`, run the command, run the tests.

Rules

- Never invent facts. A part number, footprint name or dimension must come from the PR text, the board's files, the report or a datasheet that is linked there. Write where in `source`. If you cannot tell what the part is, leave it (it stays Custom) and list it in your comment.
- Names must be as exact as you can: the footprint or part number as the report prints it. Use `*` only for a family you know from a datasheet. Never widen a name to a plain word (`HDMI`, `Ethernet`): the command refuses that; if the word really is what the part carries, put it under `"weak"`.
- Edit only `parts/` and the generated `src/model/parts.json` (by the command, not by hand). Do not edit `src/model/library.ts` or other `src/` files, the contributor's board files, `TODO.md` or `README.md`. Do not run the whole test suite or `npm run collisions`.
- Do not push to `main`. Commit to the PR branch.

Steps

1. **Find what is asked.** `git diff --name-only origin/main...HEAD -- parts/ boards/` lists what the PR changes. For an unidentified connector, take its footprint and value from the board's report (`npm run boards -- <slug>`), and what it is from the PR text.
2. **Install once.** `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`
3. **Decide the kind.** `npm run parts -- --types` lists the connector types the library has. If the part is one of them (a USB-C receptacle, an RJ45 jack, a JST-PH header...), it is a **names** entry: step 4. If no type fits and you have its dimensions and its mating plug's from a source, it is a **new type**: step 5. If neither, stop: leave it Custom and say so in the comment (step 9).
4. **Names.** Append to `parts/names-<maker or topic>.json` (create it if it does not exist), keeping to one object per connector type: `{ "type": "<id>", "names": ["<footprint or part number>"], "source": "<where you saw it>" }`. Add `"weak": [...]` for plain words that only count on a connector's reference (J1, CN2). Add `"pins"` (and `"rows"`, `"pitch"`) only for a type whose width follows its contacts (JST, Molex, box headers, FFC) and only when the name says how many.
5. **A new type.** Create `parts/type-<id>.json`, the file name as the id, from the example in `parts/README.md` (`parts/examples/type-jack635.json`): `label`, `entry` (`edge` or `top`), `body`, `plug`, `tht`, `role` (which built-in kind of port it is wired like), `offRack`, and a `look` of a few shapes: start with one `box` from `[0, 0, 0]` to `[1, 1, 1]` (the housing), a `mouth` cut into its front, and pins or a barrel if they show. Add its own `names`.
6. **Run it.** `npm run parts` and read the report from the top. Each `ERROR` and `WARNING` says what to write. Fix one at a time, editing only your files:
   - `is a plain word` / `is too short`: use the full part number or footprint name, or move a word that must stay to `"weak"`.
   - `would also match "<part>", which is no connector`: the name is too general; make it longer or exact.
   - `already recognised as <type> by the library's own patterns`: delete that name (not needed); if the whole file becomes empty, delete the file.
   - `read "<name>" as <other type>; this file makes it <type>`: fine when you are sure of the type (the library's reading was wrong); otherwise remove the name.
   - `also given for type ...`: one name cannot mean two types: keep the one you know.
   - `the shapes of "look" together are ... mm across, but the body is ...` / `sticks out of the body`: change the boxes so they span x, y and z from 0 to 1, or the body.
7. **Run again** (step 6). Repeat until the result says `0 errors` and no `WARNING` is left that you could act on. At most 5 rounds: then commit what you have and say what remains.
8. **Regenerate and test.** `npm run parts` (it writes `src/model/parts.json`) then `npm run parts -- --check` (must say `is up to date`). Then `npx vitest run tests/parts.test.ts tests/connector-names.test.ts`: both must pass. For a new type also `npx vitest run tests/toolbox.test.ts -t "each (model|picture)"` (its drawing must be the size it says; a failure that names another part's picture is not yours). `npm run typecheck` only if you touched a `.ts` file, which you should not have.
9. **Commit and comment.** `git add parts src/model/parts.json`, commit `Teach the app <what>`; in the commit body list each name or type and its source. Push to the PR branch. Then comment on the PR with the final report (what each file adds, the warnings you left and why), and "Connector library requests: <ref>, <footprint>, <value / part number>" for each connector you could not identify or draw. If the job started from a board report, say to run `npm run boards` again (`boards/AGENTS.md` step 4): the connector should now read `by name`.

If a step fails in a way this file does not cover, stop and say what happened rather than guessing.
