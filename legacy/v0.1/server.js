// Nile Therapy — management portal + per-founder AI chat
// Zero dependencies: Node 22.5+ (uses built-in node:sqlite, crypto, fetch).
// Run:  node server.js        (see README.md)

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------- config ----------
loadEnvFile(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'nile.db');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-sonnet-5-5';
const ALLOWED_MODELS = {
  'claude-sonnet-5-5': 'Sonnet (fast, everyday)',
  'claude-opus-5-5': 'Opus (deep thinking)',
};
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'; // set to 1 once on HTTPS
const SESSION_DAYS = 14;
const PUBLIC_DIR = path.join(__dirname, 'public');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------- database ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','doctor')),
  full_name TEXT NOT NULL,
  title TEXT DEFAULT '',          -- e.g. Founder & CTO / Physiotherapist
  specialty TEXT DEFAULT '',      -- e.g. Sports rehab, Neuro, Pediatrics
  phone TEXT DEFAULT '',
  area TEXT DEFAULT '',           -- where they usually work
  bio TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  patient_name TEXT NOT NULL,
  location TEXT NOT NULL,
  session_date TEXT NOT NULL,     -- YYYY-MM-DD
  session_time TEXT DEFAULT '',   -- HH:MM
  session_type TEXT DEFAULT '',   -- Home visit / Clinic / Online
  duration_min INTEGER,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_doctor ON sessions(doctor_id, session_date);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  founder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS founder_memory (
  id INTEGER PRIMARY KEY,
  founder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- passwords ----------
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { hash, salt };
}
function checkPassword(pw, user) {
  const { hash } = hashPassword(pw, user.pass_salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.pass_hash, 'hex'));
}
function randomPassword() {
  return crypto.randomBytes(6).toString('base64url'); // 8 chars
}

// ---------- first-run seed ----------
function createUser(u) {
  const { hash, salt } = hashPassword(u.password);
  const r = db.prepare(`INSERT INTO users (username, pass_hash, pass_salt, role, full_name, title, specialty, phone, area, bio)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(u.username, hash, salt, u.role, u.full_name, u.title || '', u.specialty || '',
    u.phone || '', u.area || '', u.bio || '');
  return Number(r.lastInsertRowid);
}

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const creds = [];
  const founders = [
    { username: 'abdurrahman', full_name: 'Dr. Abdurrahman', title: 'Co-founder & CTO', specialty: 'Physiotherapy' },
    { username: 'founder2', full_name: 'Founder Two', title: 'Co-founder' },
    { username: 'founder3', full_name: 'Founder Three', title: 'Co-founder' },
  ];
  for (const f of founders) {
    const password = process.env.SEED_PASSWORD || randomPassword();
    createUser({ ...f, role: 'admin', password });
    creds.push(`  admin   ${f.username.padEnd(14)} ${password}`);
  }
  if (process.env.SEED_DEMO !== '0') {
    const demo = [
      ['dr.mona', 'Dr. Mona Adel', 'Sports & orthopedic rehab', 'Nasr City'],
      ['dr.karim', 'Dr. Karim Fathy', 'Neuro rehab', 'Heliopolis'],
      ['dr.salma', 'Dr. Salma Hussein', 'Pediatric physiotherapy', 'Maadi'],
      ['dr.youssef', 'Dr. Youssef Nabil', 'Post-op & geriatric care', 'Zagazig'],
    ];
    const places = ['Home visit', 'Clinic', 'Online'];
    const patients = ['Ahmed S.', 'Mariam K.', 'Omar T.', 'Hoda M.', 'Ali R.', 'نور ح.', 'Laila F.', 'Hassan E.'];
    for (const [username, full_name, specialty, area] of demo) {
      const password = process.env.SEED_PASSWORD || randomPassword();
      const id = createUser({ username, full_name, role: 'doctor', title: 'Physiotherapist', specialty, area, password });
      creds.push(`  doctor  ${username.padEnd(14)} ${password}`);
      for (let i = 0; i < 6 + (id % 5); i++) {
        const d = new Date(Date.now() - (i * 3 + (id % 3)) * 86400000);
        const type = places[(i + id) % 3];
        db.prepare(`INSERT INTO sessions (doctor_id, patient_name, location, session_date, session_time, session_type, duration_min, notes)
          VALUES (?,?,?,?,?,?,?,?)`).run(id, patients[(i + id) % patients.length],
          type === 'Online' ? 'Video call' : `${area}, Cairo`, d.toISOString().slice(0, 10),
          `${String(10 + (i % 8)).padStart(2, '0')}:00`, type, 45 + (i % 2) * 15, i % 3 === 0 ? 'Follow-up next week' : '');
      }
    }
  }
  const out = `Nile Therapy — first-run accounts (change these after logging in):\n${creds.join('\n')}\n`;
  console.log('\n' + out);
  fs.writeFileSync(path.join(path.dirname(DB_PATH), 'FIRST_RUN_PASSWORDS.txt'), out + '\nDelete this file once everyone has logged in.\n');
}

// ---------- http helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Send JSON'));
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 200_000) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new HttpError(400, 'Bad JSON')); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function str(v, max = 500) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function publicUser(u) {
  const { pass_hash, pass_salt, ...rest } = u; return rest;
}

// ---------- auth ----------
function currentUser(req) {
  const token = cookies(req).nt_session;
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND t.expires_at > ? AND u.active = 1`).get(token, Date.now());
  return row || null;
}
function requireUser(req, role) {
  const u = currentUser(req);
  if (!u) fail(401, 'Please log in');
  if (role && u.role !== role) fail(403, 'Not allowed');
  return u;
}
const loginAttempts = new Map(); // ip -> {count, until}
function tooManyAttempts(ip) {
  const a = loginAttempts.get(ip);
  return a && a.count >= 8 && a.until > Date.now();
}
function noteFailedLogin(ip) {
  const a = loginAttempts.get(ip) || { count: 0, until: 0 };
  a.count++; a.until = Date.now() + 10 * 60 * 1000; loginAttempts.set(ip, a);
}

// ---------- sessions (clinical visits) ----------
function sessionFromBody(b) {
  const s = {
    patient_name: str(b.patient_name, 120), location: str(b.location, 200),
    session_date: str(b.session_date, 10), session_time: str(b.session_time, 5),
    session_type: str(b.session_type, 40), notes: str(b.notes, 2000),
    duration_min: b.duration_min === '' || b.duration_min == null ? null : Math.max(0, Math.min(600, parseInt(b.duration_min, 10) || 0)),
  };
  if (!s.patient_name) fail(400, 'Patient name is required');
  if (!s.location) fail(400, 'Location is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.session_date)) fail(400, 'Session date is required');
  if (s.session_time && !/^\d{2}:\d{2}$/.test(s.session_time)) fail(400, 'Bad time');
  return s;
}
function listSessions({ doctorId, from, to, q, limit = 2000 }) {
  const where = []; const args = [];
  if (doctorId) { where.push('s.doctor_id = ?'); args.push(doctorId); }
  if (from) { where.push('s.session_date >= ?'); args.push(from); }
  if (to) { where.push('s.session_date <= ?'); args.push(to); }
  if (q) { where.push('(s.patient_name LIKE ? OR s.location LIKE ? OR s.notes LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  return db.prepare(`SELECT s.*, u.full_name AS doctor_name, u.username AS doctor_username
    FROM sessions s JOIN users u ON u.id = s.doctor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.session_date DESC, s.session_time DESC, s.id DESC LIMIT ${Number(limit)}`).all(...args);
}
function doctorStats(id) {
  const month = new Date().toISOString().slice(0, 7);
  return db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN substr(session_date,1,7) = ? THEN 1 ELSE 0 END) AS this_month,
      COUNT(DISTINCT patient_name) AS patients, MAX(session_date) AS last_session
    FROM sessions WHERE doctor_id = ?`).get(month, id);
}
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s;
}

// ---------- AI ----------
function buildSystemPrompt(founder) {
  const memories = db.prepare('SELECT id, content, created_at FROM founder_memory WHERE founder_id = ? ORDER BY id').all(founder.id);
  const doctors = db.prepare(`SELECT id, full_name, username, specialty, area, active FROM users WHERE role='doctor' ORDER BY full_name`).all()
    .map(d => ({ ...d, ...doctorStats(d.id) }));
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const recent = listSessions({ from: since, limit: 400 });
  const today = new Date().toISOString().slice(0, 10);
  return `You are the management assistant inside Nile Therapy's private admin portal.
Nile Therapy is an Egyptian physiotherapy (العلاج الطبيعي) agency run by three founders. Its doctors work remotely; every patient session they do comes through Nile Therapy, and they log each session in this portal.

You are talking with ${founder.full_name} (${founder.title || 'founder'}). This chat room is private to them. Today is ${today}.
Be a practical partner for management, planning, analysis and brainstorming. Reply in the language the founder writes in (Arabic or English). Be concise and concrete. When you use numbers, base them on the data below and say if the data is incomplete. Never invent sessions or doctors.

## What you remember about ${founder.full_name}
${memories.length ? memories.map(m => `- (${m.created_at.slice(0, 10)}) ${m.content}`).join('\n') : '(nothing saved yet)'}
When the founder tells you something worth remembering for future chats (a preference, a decision, a goal, a fact about the business), call the save_memory tool. Keep each memory short. Don't save trivia or one-off questions.

## Doctors (${doctors.length})
${doctors.map(d => `- ${d.full_name} [@${d.username}] — ${d.specialty || 'n/a'}, ${d.area || 'n/a'}${d.active ? '' : ' (INACTIVE)'} — sessions total ${d.total}, this month ${d.this_month || 0}, distinct patients ${d.patients}, last ${d.last_session || 'never'}`).join('\n')}

## Sessions logged in the last 60 days (${recent.length}${recent.length >= 400 ? ', truncated' : ''})
date | time | doctor | patient | type | location | minutes | notes
${recent.map(s => [s.session_date, s.session_time, s.doctor_name, s.patient_name, s.session_type, s.location, s.duration_min ?? '', s.notes.replace(/\s+/g, ' ')].join(' | ')).join('\n')}`;
}

const TOOLS = [{
  name: 'save_memory',
  description: "Save a short fact about this founder or their business to long-term memory, so you remember it in future chats.",
  input_schema: { type: 'object', properties: { content: { type: 'string', description: 'One short sentence to remember.' } }, required: ['content'] },
}];

async function callClaude(founder, model) {
  const history = db.prepare(`SELECT role, content FROM (SELECT * FROM chat_messages WHERE founder_id = ? ORDER BY id DESC LIMIT 40) ORDER BY id`).all(founder.id);
  while (history.length && history[0].role !== 'user') history.shift();
  const messages = history.map(m => ({ role: m.role, content: m.content }));
  const saved = [];
  for (let step = 0; step < 4; step++) {
    const r = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2048, system: buildSystemPrompt(founder), tools: TOOLS, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) fail(502, `AI error: ${data?.error?.message || r.status}`);
    messages.push({ role: 'assistant', content: data.content });
    const toolUses = (data.content || []).filter(c => c.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !toolUses.length) {
      return { text: (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || '(no reply)', saved };
    }
    const results = toolUses.map(t => {
      const content = str(t.input?.content, 500);
      if (t.name === 'save_memory' && content) {
        db.prepare('INSERT INTO founder_memory (founder_id, content) VALUES (?,?)').run(founder.id, content);
        saved.push(content);
        return { type: 'tool_result', tool_use_id: t.id, content: 'Saved.' };
      }
      return { type: 'tool_result', tool_use_id: t.id, content: 'Unknown tool', is_error: true };
    });
    messages.push({ role: 'user', content: results });
  }
  return { text: '(stopped after too many tool calls)', saved };
}

function placeholderReply(founder, message) {
  const month = new Date().toISOString().slice(0, 7);
  const n = db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE substr(session_date,1,7) = ?`).get(month).n;
  const docs = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='doctor' AND active=1`).get().n;
  const saved = [];
  const m = message.match(/^\s*(remember|تذكر|افتكر)[:\s]+(.+)/i);
  if (m) {
    db.prepare('INSERT INTO founder_memory (founder_id, content) VALUES (?,?)').run(founder.id, m[2].slice(0, 500));
    saved.push(m[2].slice(0, 500));
  }
  return {
    text: `**The AI isn't connected yet** — add an \`ANTHROPIC_API_KEY\` to the \`.env\` file and restart the server.\n\n` +
      `Your chat room, history and memory are already working, though. Right now I can see **${docs} active doctors** and **${n} sessions** logged this month.` +
      (saved.length ? `\n\nSaved to your memory: “${saved[0]}”` : `\n\nTip: start a message with "remember:" to test the memory panel.`),
    saved,
  };
}

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname; const method = req.method;
  let m;

  if (p === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress;
    if (tooManyAttempts(ip)) fail(429, 'Too many attempts. Try again in 10 minutes.');
    const b = await readJson(req);
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(str(b.username, 60));
    if (!user || !checkPassword(String(b.password || ''), user)) { noteFailedLogin(ip); fail(401, 'Wrong username or password'); }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?,?,?)').run(token, user.id, Date.now() + SESSION_DAYS * 86400000);
    db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').run(Date.now());
    return send(res, 200, { user: publicUser(user) }, {
      'Set-Cookie': `nt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}`,
    });
  }
  if (p === '/api/logout' && method === 'POST') {
    const token = cookies(req).nt_session;
    if (token) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'nt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (p === '/api/me' && method === 'GET') {
    const u = currentUser(req);
    return send(res, 200, { user: u ? publicUser(u) : null, ai: { connected: !!ANTHROPIC_API_KEY, models: ALLOWED_MODELS, default: DEFAULT_MODEL } });
  }
  if (p === '/api/me/password' && method === 'POST') {
    const u = requireUser(req);
    const b = await readJson(req);
    if (!checkPassword(String(b.current || ''), u)) fail(400, 'Current password is wrong');
    if (String(b.next || '').length < 8) fail(400, 'New password must be at least 8 characters');
    const { hash, salt } = hashPassword(String(b.next));
    db.prepare('UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?').run(hash, salt, u.id);
    db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND token != ?').run(u.id, cookies(req).nt_session);
    return send(res, 200, { ok: true });
  }

  // ----- sessions -----
  if (p === '/api/sessions' && method === 'GET') {
    const u = requireUser(req);
    const q = url.searchParams;
    const doctorId = u.role === 'doctor' ? u.id : (Number(q.get('doctor_id')) || null);
    return send(res, 200, { sessions: listSessions({ doctorId, from: q.get('from'), to: q.get('to'), q: str(q.get('q') || '', 100) }) });
  }
  if (p === '/api/sessions' && method === 'POST') {
    const u = requireUser(req);
    const b = await readJson(req);
    const s = sessionFromBody(b);
    let doctorId = u.id;
    if (u.role === 'admin') {
      doctorId = Number(b.doctor_id);
      if (!db.prepare(`SELECT 1 FROM users WHERE id=? AND role='doctor'`).get(doctorId)) fail(400, 'Pick a doctor');
    }
    const r = db.prepare(`INSERT INTO sessions (doctor_id, patient_name, location, session_date, session_time, session_type, duration_min, notes)
      VALUES (?,?,?,?,?,?,?,?)`).run(doctorId, s.patient_name, s.location, s.session_date, s.session_time, s.session_type, s.duration_min, s.notes);
    return send(res, 201, { id: Number(r.lastInsertRowid) });
  }
  if ((m = p.match(/^\/api\/sessions\/(\d+)$/)) && (method === 'PUT' || method === 'DELETE')) {
    const u = requireUser(req);
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(m[1]));
    if (!row) fail(404, 'Not found');
    if (u.role === 'doctor' && row.doctor_id !== u.id) fail(403, 'Not your session');
    if (method === 'DELETE') { db.prepare('DELETE FROM sessions WHERE id=?').run(row.id); return send(res, 200, { ok: true }); }
    const s = sessionFromBody(await readJson(req));
    db.prepare(`UPDATE sessions SET patient_name=?, location=?, session_date=?, session_time=?, session_type=?, duration_min=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .run(s.patient_name, s.location, s.session_date, s.session_time, s.session_type, s.duration_min, s.notes, row.id);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/sessions.csv' && method === 'GET') {
    requireUser(req, 'admin');
    const q = url.searchParams;
    const rows = listSessions({ doctorId: Number(q.get('doctor_id')) || null, from: q.get('from'), to: q.get('to'), q: str(q.get('q') || '', 100), limit: 100000 });
    const cols = ['session_date', 'session_time', 'doctor_name', 'patient_name', 'session_type', 'location', 'duration_min', 'notes', 'created_at'];
    const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n');
    return send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="nile-therapy-sessions-${new Date().toISOString().slice(0, 10)}.csv"` });
  }

  // ----- doctors (admin) -----
  if (p === '/api/doctors' && method === 'GET') {
    requireUser(req, 'admin');
    const doctors = db.prepare(`SELECT * FROM users WHERE role='doctor' ORDER BY active DESC, full_name`).all()
      .map(d => ({ ...publicUser(d), stats: doctorStats(d.id) }));
    return send(res, 200, { doctors });
  }
  if (p === '/api/doctors' && method === 'POST') {
    requireUser(req, 'admin');
    const b = await readJson(req);
    const username = str(b.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Username: 3+ characters, letters/numbers/._- only');
    if (!str(b.full_name, 120)) fail(400, 'Full name is required');
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) fail(409, 'That username is taken');
    const password = randomPassword();
    const id = createUser({ username, password, role: 'doctor', full_name: str(b.full_name, 120), title: str(b.title, 80) || 'Physiotherapist',
      specialty: str(b.specialty, 120), phone: str(b.phone, 40), area: str(b.area, 120), bio: str(b.bio, 2000) });
    return send(res, 201, { id, username, password });
  }
  if ((m = p.match(/^\/api\/doctors\/(\d+)$/)) && method === 'GET') {
    requireUser(req, 'admin');
    const d = db.prepare(`SELECT * FROM users WHERE id=? AND role='doctor'`).get(Number(m[1]));
    if (!d) fail(404, 'Not found');
    const sessions = listSessions({ doctorId: d.id });
    const patients = db.prepare(`SELECT patient_name, COUNT(*) AS sessions, MAX(session_date) AS last FROM sessions WHERE doctor_id=? GROUP BY patient_name ORDER BY last DESC`).all(d.id);
    return send(res, 200, { doctor: { ...publicUser(d), stats: doctorStats(d.id) }, sessions, patients });
  }
  if ((m = p.match(/^\/api\/doctors\/(\d+)$/)) && method === 'PUT') {
    requireUser(req, 'admin');
    const b = await readJson(req);
    const d = db.prepare(`SELECT * FROM users WHERE id=? AND role='doctor'`).get(Number(m[1]));
    if (!d) fail(404, 'Not found');
    db.prepare(`UPDATE users SET full_name=?, title=?, specialty=?, phone=?, area=?, bio=?, active=? WHERE id=?`).run(
      str(b.full_name, 120) || d.full_name, str(b.title, 80), str(b.specialty, 120), str(b.phone, 40), str(b.area, 120), str(b.bio, 2000),
      b.active === false || b.active === 0 ? 0 : 1, d.id);
    if (b.active === false || b.active === 0) db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(d.id);
    return send(res, 200, { ok: true });
  }
  if ((m = p.match(/^\/api\/doctors\/(\d+)\/reset-password$/)) && method === 'POST') {
    requireUser(req, 'admin');
    const d = db.prepare(`SELECT * FROM users WHERE id=? AND role='doctor'`).get(Number(m[1]));
    if (!d) fail(404, 'Not found');
    const password = randomPassword();
    const { hash, salt } = hashPassword(password);
    db.prepare('UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?').run(hash, salt, d.id);
    db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(d.id);
    return send(res, 200, { username: d.username, password });
  }

  // ----- founder chat (each founder only ever sees their own) -----
  if (p === '/api/chat' && method === 'GET') {
    const u = requireUser(req, 'admin');
    const messages = db.prepare('SELECT id, role, content, model, created_at FROM chat_messages WHERE founder_id=? ORDER BY id').all(u.id);
    const memory = db.prepare('SELECT id, content, created_at FROM founder_memory WHERE founder_id=? ORDER BY id DESC').all(u.id);
    return send(res, 200, { messages, memory });
  }
  if (p === '/api/chat' && method === 'POST') {
    const u = requireUser(req, 'admin');
    const b = await readJson(req);
    const message = str(b.message, 20000);
    if (!message) fail(400, 'Empty message');
    const model = ALLOWED_MODELS[b.model] ? b.model : DEFAULT_MODEL;
    db.prepare(`INSERT INTO chat_messages (founder_id, role, content) VALUES (?, 'user', ?)`).run(u.id, message);
    let reply;
    try {
      reply = ANTHROPIC_API_KEY ? await callClaude(u, model) : placeholderReply(u, message);
    } catch (e) {
      db.prepare(`DELETE FROM chat_messages WHERE id = (SELECT MAX(id) FROM chat_messages WHERE founder_id=?)`).run(u.id);
      throw e;
    }
    db.prepare(`INSERT INTO chat_messages (founder_id, role, content, model) VALUES (?, 'assistant', ?, ?)`).run(u.id, reply.text, ANTHROPIC_API_KEY ? model : 'placeholder');
    return send(res, 200, { reply: reply.text, saved_memory: reply.saved });
  }
  if (p === '/api/chat' && method === 'DELETE') {
    const u = requireUser(req, 'admin');
    db.prepare('DELETE FROM chat_messages WHERE founder_id=?').run(u.id);
    return send(res, 200, { ok: true });
  }
  if ((m = p.match(/^\/api\/memory\/(\d+)$/)) && method === 'DELETE') {
    const u = requireUser(req, 'admin');
    db.prepare('DELETE FROM founder_memory WHERE id=? AND founder_id=?').run(Number(m[1]), u.id);
    return send(res, 200, { ok: true });
  }

  fail(404, 'Unknown endpoint');
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : e.message });
  }
});
server.listen(PORT, () => {
  console.log(`Nile Therapy portal running on http://localhost:${PORT}`);
  console.log(ANTHROPIC_API_KEY ? `AI connected (default model ${DEFAULT_MODEL})` : 'AI not connected yet — add ANTHROPIC_API_KEY to .env (chat runs in placeholder mode)');
});
