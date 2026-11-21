// Safety checks for the website. Runs automatically before every deploy (pages.yml);
// if anything fails, nothing is published. Run it yourself with:  node scripts/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const problems = [];
const fail = msg => problems.push(msg);
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const jsFiles = fs.readdirSync(PUB).filter(f => f.endsWith('.js'));

// 1. Every script is valid JavaScript.
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', path.join(PUB, f)], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${f} has a syntax error:\n${r.stderr.trim()}`);
}

// 2. index.html points only at files that exist, and loads every script.
const html = read('index.html');
const local = [...html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].map(m => m[1]);
for (const f of local) if (!fs.existsSync(path.join(PUB, f))) fail(`index.html links to ${f}, which doesn't exist`);
for (const f of jsFiles) if (!local.includes(f)) fail(`${f} exists but index.html doesn't load it`);
if (!html.includes('?v=dev')) fail('index.html lost its ?v=dev version tags (needed so browsers load fresh files after a deploy)');

// 3. Every interface text exists in both English and Arabic.
const ctx = { localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: {}, title: '' } };
vm.createContext(ctx);
vm.runInContext(read('i18n.js') + ';this.S = STRINGS;', ctx);
const en = Object.keys(ctx.S.en), ar = Object.keys(ctx.S.ar);
for (const k of en) if (!ar.includes(k)) fail(`Arabic text missing for "${k}"`);
for (const k of ar) if (!en.includes(k)) fail(`English text missing for "${k}"`);
const code = jsFiles.filter(f => f !== 'i18n.js').map(read).join('\n');
const used = new Set([...code.matchAll(/\bt\('([A-Za-z0-9_.-]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('.') && k !== 'key'));
for (const k of used) if (!en.includes(k)) fail(`Code uses text "${k}" that isn't in i18n.js`);

// 4. No secrets in the public website.
const secretPatterns = [[/sb_secret_[A-Za-z0-9_-]+/, 'a Supabase SECRET key'], [/sk-ant-[A-Za-z0-9_-]{10,}/, 'an Anthropic API key'],
  [/service_role/, 'the words "service_role"']];
for (const f of fs.readdirSync(PUB)) {
  if (!/\.(js|html|css|json|webmanifest)$/.test(f)) continue;
  const text = read(f);
  for (const [re, what] of secretPatterns) if (re.test(text)) fail(`${f} contains ${what}. Never publish secret keys!`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    try { if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).role !== 'anon') fail(`${f} contains a non-public Supabase key`); } catch { /* not a key */ }
  }
}

// 5. Use the red confirm dialog, not the browser's plain confirm().
for (const f of jsFiles) if (/(^|[^.\w])confirm\(/m.test(read(f))) fail(`${f} uses the browser's confirm(); use confirmAction() instead`);

// 6. The home-screen app file is valid and its icons exist.
try {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const i of m.icons) if (!fs.existsSync(path.join(PUB, i.src))) fail(`manifest icon ${i.src} is missing`);
} catch (e) { fail(`manifest.webmanifest is not valid JSON: ${e.message}`); }

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) found, so the site was NOT published:\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log(`✓ All checks passed (${jsFiles.length} scripts, ${en.length} texts in English and Arabic, no secrets).`);
