// Email alerts through Resend. Woken by the database (a new website booking / referral, via pg_net) and by a cron job
// every 10 minutes. Each call sends whatever is still unsent; email_log makes every email go out once (up to 3 tries).
// Emails never contain the patient's name, phone or complaint: only what is needed to know there is work, plus a link
// to the portal, where the details are behind a login.
// No login needed to wake it (it returns nothing but {ok}); the 'test' action needs a founder or tech login.
// Needs the secret RESEND_API_KEY, and email_settings.enabled + addresses (set on the tech page, Emails tab).
import { admin, bearer, HttpError, serve } from '../_shared/common.ts';

const PORTAL = 'https://odostore11-creator.github.io/nile-therapy/';
const KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const ERRORS_PER_HOUR = 10;

type Settings = { enabled: boolean; from_address: string; bookings_to: string[]; weekly_to: string[]; tech_to: string[] };

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const SERVICE: Record<string, [string, string]> = {
  'home-assessment': ['تقييم منزلي', 'Home assessment'], orthopedic: ['عظام', 'Orthopedic'], neuro: ['أعصاب', 'Neuro'], other: ['أخرى', 'Other'],
};
const SLOT: Record<string, [string, string]> = { morning: ['صباحاً', 'morning'], afternoon: ['بعد الظهر', 'afternoon'], evening: ['مساءً', 'evening'], any: ['أي وقت', 'any time'] };
const URGENCY: Record<string, [string, string]> = { urgent: ['عاجل', 'Urgent'], this_week: ['هذا الأسبوع', 'This week'], flexible: ['مرن', 'Flexible'] };

/** Cairo wall-clock parts. */
function cairo(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, weekday: p.weekday as string };
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** One email layout: Arabic block, then English, then a button. */
function layout(title: [string, string], rowsAr: string[], rowsEn: string[], button: [string, string], link: string) {
  const list = (rows: string[]) => rows.map(r => `<li style="margin:4px 0">${r}</li>`).join('');
  const html = `<div style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:560px;margin:auto;color:#0b2e33">
  <div style="background:#0f7d74;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Nile Therapy</div>
  <div style="border:1px solid #d5e8e4;border-top:0;padding:18px;border-radius:0 0 10px 10px">
    <div dir="rtl" style="text-align:right"><h2 style="margin:0 0 8px;font-size:18px">${title[0]}</h2><ul style="padding-right:18px;margin:0">${list(rowsAr)}</ul></div>
    <hr style="border:0;border-top:1px solid #e3efec;margin:16px 0">
    <div dir="ltr"><h2 style="margin:0 0 8px;font-size:18px">${title[1]}</h2><ul style="padding-left:18px;margin:0">${list(rowsEn)}</ul></div>
    <p style="margin:20px 0 4px;text-align:center"><a href="${link}" style="background:#0f7d74;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;display:inline-block">${button[0]} · ${button[1]}</a></p>
    <p style="color:#5b7a78;font-size:12px;text-align:center;margin-top:14px">التفاصيل داخل البوابة فقط · Details are only inside the portal.</p>
  </div></div>`;
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [title[0], ...rowsAr.map(r => '- ' + strip(r)), '', title[1], ...rowsEn.map(r => '- ' + strip(r)), '', link].join('\n');
  return { html, text };
}

async function sendEmail(s: Settings, to: string[], subject: string, body: { html: string; text: string }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: s.from_address, to, subject, html: body.html, text: body.text }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`Resend ${r.status}: ${String(j.message ?? j.name ?? '').slice(0, 220)}`);
  }
}

/** Reserve (kind, ref) in email_log. Returns the log id, or null if it was already sent / is being sent / ran out of tries. */
async function claim(kind: string, ref: string): Promise<number | null> {
  const { data, error } = await admin.from('email_log').insert({ kind, ref }).select('id').maybeSingle();
  if (data) return data.id;
  if (error && error.code !== '23505') throw error;
  const { data: row } = await admin.from('email_log').select('id, status, attempts, updated_at').eq('kind', kind).eq('ref', ref).maybeSingle();
  if (!row || row.status !== 'failed' || row.attempts >= 3 || Date.now() - Date.parse(row.updated_at) < 5 * 60e3) return null;
  const { data: again } = await admin.from('email_log').update({ status: 'sending', attempts: row.attempts + 1, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'failed').eq('attempts', row.attempts).select('id').maybeSingle();
  return again?.id ?? null;
}
async function finish(id: number, recipients: number, err?: unknown) {
  await admin.from('email_log').update({ status: err ? 'failed' : 'sent', recipients, error: err ? String((err as Error).message ?? err).slice(0, 300) : '',
    updated_at: new Date().toISOString() }).eq('id', id);
}
async function deliver(s: Settings, kind: string, ref: string, to: string[], subject: string, make: () => Promise<{ html: string; text: string }>) {
  if (!to.length) return;
  const id = await claim(kind, ref);
  if (id === null) return;
  try { await sendEmail(s, to, subject, await make()); await finish(id, to.length); }
  catch (e) { console.error(kind, ref, e); await finish(id, 0, e); }
}

/** Ids from the last day that have no email yet (or a failed one that may be retried). */
async function unsent(kind: string, ids: number[]) {
  if (!ids.length) return [];
  const { data } = await admin.from('email_log').select('ref, status, attempts').eq('kind', kind).in('ref', ids.map(String));
  const done = new Set((data ?? []).filter(r => r.status !== 'failed' || r.attempts >= 3).map(r => r.ref));
  return ids.filter(id => !done.has(String(id)));
}

async function doctorName(id: string | null) {
  if (!id) return '';
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle();
  return data?.full_name ?? '';
}

async function bookings(s: Settings) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data } = await admin.from('patient_requests').select('id, governorate, service, preferred_date, preferred_slot, status, reason, assigned_doctor_id')
    .eq('source', 'website').gte('created_at', since).order('id').limit(50);
  const rows = data ?? [];
  for (const id of await unsent('booking', rows.map(r => r.id))) {
    const r = rows.find(x => x.id === id)!;
    await deliver(s, 'booking', String(id), s.bookings_to, `حجز جديد من الموقع · New website booking — ${r.governorate || ''}`, async () => {
      const doc = await doctorName(r.assigned_doctor_id);
      const svc = SERVICE[r.service] ?? ['غير محدد', 'Not chosen'];
      const slot = SLOT[r.preferred_slot] ?? SLOT.any;
      const auto = r.status === 'assigned' && doc;
      const what: [string, string] = auto ? [`تم الحجز تلقائياً مع ${esc(doc)}`, `Booked automatically with ${esc(doc)}`]
        : r.status === 'open' ? ['معروض على الأطباء المتاحين (أقرب طبيب ممتلئ)', 'Offered to doctors with room (the nearest one is full)']
        : ['يحتاج قراراً من أحد المؤسسين', 'Needs a founder to assign it'];
      return layout(['طلب حجز جديد من الموقع', 'New booking from the website'],
        [`المحافظة: <b>${esc(r.governorate)}</b>`, `الخدمة: ${svc[0]}`, `اليوم المفضّل: ${esc(r.preferred_date)} · ${slot[0]}`, `<b>${what[0]}</b>`],
        [`Governorate: <b>${esc(r.governorate)}</b>`, `Service: ${svc[1]}`, `Preferred day: ${esc(r.preferred_date)} · ${slot[1]}`, `<b>${what[1]}</b>`],
        ['افتح صندوق الطلبات', 'Open the inbox'], PORTAL + '#/inbox');
    });
  }
}

async function referrals(s: Settings) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data } = await admin.from('referrals').select('id, partner_id, governorate, urgency, preferred_start').gte('created_at', since).order('id').limit(50);
  const rows = data ?? [];
  for (const id of await unsent('referral', rows.map(r => r.id))) {
    const r = rows.find(x => x.id === id)!;
    const urg = URGENCY[r.urgency] ?? URGENCY.flexible;
    await deliver(s, 'referral', String(id), s.bookings_to, `${r.urgency === 'urgent' ? '⚠ ' : ''}إحالة جديدة · New referral — ${r.governorate || ''}`, async () => {
      const { data: p } = await admin.from('partner_profiles').select('organization, contact_person').eq('id', r.partner_id).maybeSingle();
      const from = esc(p?.organization || p?.contact_person || '—');
      return layout(['إحالة جديدة من شريك', 'New referral from a partner'],
        [`من: <b>${from}</b>`, `المحافظة: ${esc(r.governorate)}`, `الأولوية: <b>${urg[0]}</b>`, r.preferred_start ? `البدء المفضّل: ${esc(r.preferred_start)}` : ''].filter(Boolean),
        [`From: <b>${from}</b>`, `Governorate: ${esc(r.governorate)}`, `Urgency: <b>${urg[1]}</b>`, r.preferred_start ? `Preferred start: ${esc(r.preferred_start)}` : ''].filter(Boolean),
        ['افتح صندوق الطلبات', 'Open the inbox'], PORTAL + '#/inbox');
    });
  }
}

async function weekly(s: Settings) {
  const now = cairo();
  if (now.weekday !== 'Sat' || now.hour < 8) return; // Saturday from 8:00, Cairo
  const start = addDays(now.date, -7);
  await deliver(s, 'weekly', start, s.weekly_to, `ملخص الأسبوع · Weekly summary ${start}`, async () => {
    const { data: d, error } = await admin.rpc('weekly_digest', { p_week_start: start });
    if (error) throw error;
    const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-US');
    const diff = Number(d.sessions) - Number(d.sessions_prev);
    const sign = diff > 0 ? `+${diff}` : String(diff);
    const docs = (d.per_doctor as { name: string; n: number }[]);
    const quiet = docs.filter(x => !x.n).map(x => esc(x.name));
    const docAr = docs.map(x => `${esc(x.name)}: ${x.n}`).join('، ');
    const docEn = docs.map(x => `${esc(x.name)}: ${x.n}`).join(', ');
    return layout([`ملخص الأسبوع ${d.week_start} → ${d.week_end}`, `Week ${d.week_start} → ${d.week_end}`],
      [`الجلسات: <b>${n(d.sessions)}</b> (${sign} عن الأسبوع السابق)`, `الإيراد: <b>${n(d.income)} ج.م</b> · عمولة نايل: <b>${n(d.commission)} ج.م</b>`,
        Number(d.unpriced) ? `جلسات بدون سعر: ${n(d.unpriced)}` : '', `حجوزات الموقع: ${n(d.website_bookings)} · إحالات: ${n(d.referrals)}`,
        `طلبات تنتظر الآن: <b>${n(d.waiting)}</b> · زيارات مفتوحة: ${n(d.open_visits)}`, docAr ? `حسب الطبيب: ${docAr}` : '',
        quiet.length ? `بدون جلسات هذا الأسبوع: ${quiet.join('، ')}` : ''].filter(Boolean),
      [`Sessions: <b>${n(d.sessions)}</b> (${sign} vs the week before)`, `Income: <b>${n(d.income)} EGP</b> · Nile's commission: <b>${n(d.commission)} EGP</b>`,
        Number(d.unpriced) ? `Sessions without a price: ${n(d.unpriced)}` : '', `Website bookings: ${n(d.website_bookings)} · Referrals: ${n(d.referrals)}`,
        `Waiting now: <b>${n(d.waiting)}</b> · Open visits: ${n(d.open_visits)}`, docEn ? `By doctor: ${docEn}` : '',
        quiet.length ? `No sessions this week: ${quiet.join(', ')}` : ''].filter(Boolean),
      ['افتح الحسابات', 'Open Money'], PORTAL + '#/money');
  });
}

async function errorSpike(s: Settings) {
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { data, count } = await admin.from('client_errors').select('page', { count: 'exact' }).gte('created_at', since).limit(200);
  if ((count ?? 0) < ERRORS_PER_HOUR) return;
  const now = cairo();
  const ref = `${now.date}-${Math.floor(now.hour / 6)}`; // at most one email per 6 hours
  const pages: Record<string, number> = {};
  for (const r of data ?? []) pages[r.page || '?'] = (pages[r.page || '?'] ?? 0) + 1;
  const top = Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, c]) => `${esc(p)} (${c})`).join(', ');
  await deliver(s, 'errors', ref, s.tech_to, `أخطاء كثيرة في البوابة · Many portal errors (${count}/h)`, async () =>
    layout(['أخطاء كثيرة في البوابة', 'Many errors in the portal'],
      [`${count} خطأ في آخر ساعة`, `الصفحات: ${top}`], [`${count} errors in the last hour`, `Pages: ${top}`],
      ['افتح سجل الأخطاء', 'Open the error log'], PORTAL + '#/errors'));
}

async function settings(): Promise<Settings> {
  const { data, error } = await admin.from('email_settings').select('enabled, from_address, bookings_to, weekly_to, tech_to').eq('id', 1).single();
  if (error) throw error;
  return data as Settings;
}

/** Founders or the tech team: send a test email to every address in the settings. */
async function test(req: Request) {
  const token = bearer(req);
  if (!token || token.startsWith('sb_')) throw new HttpError(401, 'Please log in');
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) throw new HttpError(401, 'Please log in again');
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', u.user.id).maybeSingle();
  if (!me?.active || !['admin', 'tech'].includes(me.role)) throw new HttpError(403, 'Only founders or the technical team can do this');
  if (!KEY) throw new HttpError(400, 'RESEND_API_KEY is not set yet (Supabase > Edge Functions > Secrets).');
  const { count } = await admin.from('email_log').select('id', { count: 'exact', head: true }).eq('kind', 'test').gte('created_at', new Date(Date.now() - 60e3).toISOString());
  if ((count ?? 0) > 0) throw new HttpError(429, 'Wait a minute before sending another test.');
  const s = await settings();
  const to = [...new Set([...s.bookings_to, ...s.weekly_to, ...s.tech_to])];
  if (!to.length) throw new HttpError(400, 'Add at least one email address first.');
  const { data: row } = await admin.from('email_log').insert({ kind: 'test', ref: String(Date.now()) }).select('id').single();
  try {
    await sendEmail(s, to, 'تجربة · Test email — Nile Therapy', layout(['رسالة تجربة', 'Test email'],
      ['إذا وصلتك هذه الرسالة فتنبيهات البريد تعمل.'], ['If you got this, email alerts work.'], ['افتح البوابة', 'Open the portal'], PORTAL));
    await finish(row!.id, to.length);
  } catch (e) {
    await finish(row!.id, 0, e);
    throw new HttpError(502, (e as Error).message);
  }
  return { ok: true, recipients: to.length };
}

serve(async (req, body) => {
  if (body.action === 'test') return await test(req);
  if (!KEY) return { ok: true };
  const s = await settings();
  if (!s.enabled) return { ok: true };
  for (const job of [bookings, referrals, weekly, errorSpike]) {
    try { await job(s); } catch (e) { console.error(job.name, e); }
  }
  return { ok: true };
});
