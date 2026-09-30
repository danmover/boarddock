// npm run parts: check the files in parts/ and write what the app reads from them (see parts/README.md).
//
//   npm run parts                     check every file in parts/; write src/model/parts.json
//   npm run parts -- --dry            report only, write nothing
//   npm run parts -- --check          write nothing; exit 1 if src/model/parts.json is not what the folder makes (CI)
//   npm run parts -- --strict         warnings (a name the library already knows...) count as failures too
//   npm run parts -- --report FILE    also save the report to FILE
//   npm run parts -- --types          list the connector types, wiring roles and materials a file may use
//   --dir DIR / --out FILE            where the files are (parts) and where the data goes (src/model/parts.json)
//
// It prints what each file does (names, new types) with every ERROR and WARNING, and exits 1 on an error, in which case
// it writes nothing. The work is done by scripts/parts-lib.ts, run through Vite so it uses the app's own library.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const value = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; if (!v || v.startsWith('--')) { console.error(`${n} needs a value`); process.exit(2); } args.splice(i, 2); return v; };
const dry = flag('--dry'), check = flag('--check'), strict = flag('--strict'), types = flag('--types');
const reportFile = value('--report');
const dir = path.resolve(value('--dir') ?? path.join(root, 'parts'));
const out = path.resolve(value('--out') ?? path.join(root, 'src', 'model', 'parts.json'));
if (args.length) { console.error(`Usage: npm run parts -- [--dry] [--check] [--strict] [--report FILE] [--types] [--dir DIR] [--out FILE]\nNot understood: ${args.join(' ')}`); process.exit(2); }

const { createServer } = await import('vite');
const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
let code = 0;
try {
  const lib = await server.ssrLoadModule('/scripts/parts-lib.ts');
  if (types) console.log(lib.typeList());
  else {
    const built = lib.readParts(dir);
    let text = built.report;
    if (strict && built.warnings.length && !built.errors.length) { code = 1; text += ' (--strict: warnings fail)'; }
    if (built.errors.length) code = 1;
    else {
      const rel = path.relative(process.cwd(), out) || out;
      if (check) {
        if (lib.stale(built.data, out)) { code = 1; text += `\n\n${rel} is out of date. Run \`npm run parts\` and commit ${rel}.`; } else text += `\n${rel} is up to date.`;
      } else if (!dry) {
        const was = lib.stale(built.data, out);
        if (was) fs.writeFileSync(out, lib.dump(built.data));
        text += was ? `\nWrote ${rel}.` : `\n${rel} was already up to date.`;
      }
    }
    console.log(text);
    if (reportFile) fs.writeFileSync(reportFile, text + '\n');
  }
} catch (e) {
  console.error(e?.stack ?? e);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
