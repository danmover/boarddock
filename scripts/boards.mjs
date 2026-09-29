// npm run boards: turn the folders under boards/ into the community boards the app offers (see boards/README.md).
//
//   npm run boards                    every folder under boards/; writes public/boards/
//   npm run boards -- <slug>          only boards/<slug>/ (its file and its row in the list; the rest is left alone)
//   npm run boards -- --dry           report only, write nothing
//   npm run boards -- --check         write nothing; exit 1 if public/boards is not what the folders make (CI)
//   npm run boards -- --strict        warnings (a connector left Custom, no license...) count as failures too
//   npm run boards -- --report FILE   also save the report to FILE
//   npm run boards -- --types         list the connector ids that board.json may use
//   --boards DIR / --out DIR          where the folders are (boards) and where the data goes (public/boards)
//
// It prints a report per board (outline, holes, every connector and how it was identified, warnings) and exits 1 on
// a hard error (a board that cannot be read, a bad board.json), in which case it writes nothing.
// The work is done by scripts/boards-lib.ts, run through Vite so it can use the app's own TypeScript importers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const value = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; if (!v || v.startsWith('--')) { console.error(`${n} needs a value`); process.exit(2); } args.splice(i, 2); return v; };
const dry = flag('--dry'), check = flag('--check'), strict = flag('--strict'), types = flag('--types');
const reportFile = value('--report');
const boardsDir = path.resolve(value('--boards') ?? path.join(root, 'boards'));
const outDir = path.resolve(value('--out') ?? path.join(root, 'public', 'boards'));
const unknown = args.filter((a) => a.startsWith('--'));
if (unknown.length || args.length > 1) { console.error(`Usage: npm run boards -- [<slug>] [--dry] [--check] [--strict] [--report FILE] [--types]\nNot understood: ${(unknown.length ? unknown : args.slice(1)).join(' ')}`); process.exit(2); }
const slug = args[0]?.replace(/^boards[\\/]/, '').replace(/[\\/]+$/, '');

const { createServer } = await import('vite');
const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
let code = 0;
try {
  const lib = await server.ssrLoadModule('/scripts/boards-lib.ts');
  if (types) { console.log(lib.typeList()); } else {
    const dirs = slug ? [path.join(boardsDir, slug)] : lib.boardFolders(boardsDir);
    if (slug && !fs.existsSync(dirs[0])) {
      console.error(`There is no folder ${path.relative(process.cwd(), dirs[0])}. Folders: ${lib.boardFolders(boardsDir).map((d) => path.basename(d)).join(', ') || '(none yet)'}`);
      code = 2;
    } else {
      const built = [];
      for (const d of dirs) built.push(await lib.buildBoard(d));
      const errors = built.reduce((n, b) => n + b.errors.length, 0), warnings = built.reduce((n, b) => n + b.warnings.length, 0);
      let out = built.map((b) => b.report).join('\n\n');
      const summary = `${built.length} board${built.length === 1 ? '' : 's'}: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
      if (built.length) out += '\n\n';
      out += summary;
      if (errors) code = 1;
      else if (strict && warnings) { code = 1; out += ' (--strict: warnings fail)'; }
      if (!errors) {
        const plan = lib.plan(built, outDir, slug);
        const rel = path.relative(process.cwd(), outDir) || '.';
        if (check) {
          const bad = lib.stale(plan, outDir);
          if (bad.length) { code = 1; out += `\n\n${rel} is out of date (${bad.join(', ')}). Run \`npm run boards\` and commit ${rel}.`; } else out += `\n${rel} is up to date.`;
        } else if (!dry) {
          const bad = lib.stale(plan, outDir);
          lib.apply(plan, outDir);
          out += bad.length ? `\nWrote ${rel}: ${bad.join(', ')}.` : `\n${rel} was already up to date.`;
        }
      }
      console.log(out);
      if (reportFile) fs.writeFileSync(reportFile, out + '\n');
    }
  }
} catch (e) {
  console.error(e?.stack ?? e);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
