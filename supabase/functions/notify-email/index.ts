// Email alerts through Resend. Woken by the database (a new website booking / referral, via pg_net) and by a cron job
// every 10 minutes. Each call sends whatever is still unsent; email_log makes every email go out once (up to 3 tries).
// Team emails never contain the patient's name, phone or complaint: only what is needed to know there is work, plus a link
// to the portal, where the details are behind a login. The PATIENT's own summary (patientEmails) goes only to the email they typed.
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

async function sendEmail(s: Settings, to: string[], subject: string, body: { html: string; text: string }, replyTo?: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: s.from_address, to, subject, html: body.html, text: body.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
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
async function deliver(s: Settings, kind: string, ref: string, to: string[], subject: string, make: () => Promise<{ html: string; text: string }>, replyTo?: string) {
  if (!to.length) return;
  const id = await claim(kind, ref);
  if (id === null) return;
  try { await sendEmail(s, to, subject, await make(), replyTo); await finish(id, to.length); }
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

// ---------- the patient's own booking summary (only when they typed an email on the website form) ----------
// Their own details only (no doctor name: assignment can change). Prices: KEEP IN SYNC with nile-site/src/content.mjs SERVICES.
const SITE = 'https://www.niletherapy.org';
const CONTACT = { email: 'niletherapy.egy@gmail.com', wa: '201022478412', phone: '+20 102 247 8412' };
const SERVICE_FULL: Record<string, { ar: string; en: string; price: number }> = {
  'home-assessment': { ar: 'كشف منزلي وجلسة أولى', en: 'Home assessment & first session', price: 800 },
  orthopedic: { ar: 'علاج طبيعي للعظام وما بعد الجراحة', en: 'Orthopedic & post-surgery physiotherapy', price: 500 },
  neuro: { ar: 'تأهيل المخ والأعصاب والحبل الشوكي', en: 'Neurological & spinal cord rehabilitation', price: 500 },
};
const GOV_AR: Record<string, string> = { Cairo: 'القاهرة', Giza: 'الجيزة', Alexandria: 'الإسكندرية', Qalyubia: 'القليوبية', Sharqia: 'الشرقية',
  Dakahlia: 'الدقهلية', Gharbia: 'الغربية', Monufia: 'المنوفية', Beheira: 'البحيرة', 'Kafr El Sheikh': 'كفر الشيخ', Damietta: 'دمياط', 'Port Said': 'بورسعيد',
  Ismailia: 'الإسماعيلية', Suez: 'السويس', Fayoum: 'الفيوم', 'Beni Suef': 'بني سويف', Minya: 'المنيا', Assiut: 'أسيوط', Sohag: 'سوهاج', Qena: 'قنا',
  Luxor: 'الأقصر', Aswan: 'أسوان', 'Red Sea': 'البحر الأحمر', 'New Valley': 'الوادي الجديد', Matrouh: 'مطروح', 'North Sinai': 'شمال سيناء', 'South Sinai': 'جنوب سيناء' };
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";
const PATIENT_EMAILS_PER_DAY = 2; // per address: a typo'd or someone else's email can't be flooded

function patientLayout(ar: boolean, r: Record<string, any>) {
  const svc = SERVICE_FULL[r.service];
  const day = r.preferred_date ? new Date(r.preferred_date + 'T12:00:00Z').toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const slot = (SLOT[r.preferred_slot] ?? SLOT.any)[ar ? 0 : 1].replace(/^./, c => c.toUpperCase());
  const gov = ar ? (GOV_AR[r.governorate] ?? r.governorate) : r.governorate;
  const booked = new Date().toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' });
  const T = ar ? {
    status: 'تم استلام طلبك', title: 'ملخص طلب الحجز', hi: `أهلاً ${esc(r.patient_name)}،`,
    lead: `شكراً لاختيارك نايل ثيرابي. استلمنا طلب الحجز، وسيتصل بك فريقنا على <b dir="ltr" style="font-family:${MONO}">${esc(r.phone)}</b> لتأكيد الموعد.`,
    no: 'رقم الطلب', date: 'تاريخ الطلب', service: 'الخدمة', day: 'اليوم المفضّل', time: 'الوقت', area: 'العنوان',
    priceL: 'السعر', currency: 'ج.م', priceNote: 'الدفع نقداً بعد الجلسة — لا يُدفع شيء الآن', noPrice: 'يُحدَّد عند تأكيد الموعد',
    notChosen: 'سنساعدك في اختيارها', next: 'الخطوات التالية',
    steps: [['نتصل بك', 'لتأكيد اليوم والوقت المناسبين.'], ['نزورك في بيتك', 'أخصائي علاج طبيعي يأتي إليك.'], ['الدفع بعد الجلسة', 'نقداً، بعد انتهاء الجلسة.']],
    wa: 'تواصل معنا عبر واتساب', help: 'لديك سؤال أو تريد تغيير الموعد؟ ردّ على هذه الرسالة أو راسلنا على واتساب.',
    foot: 'هذا ملخص لطلبك وليس فاتورة. وصلتك هذه الرسالة لأن هذا البريد كُتب في نموذج الحجز على niletherapy.org؛ إذا لم تكن أنت فتجاهلها.',
    pre: `طلب رقم ${r.id} — سنتصل بك لتأكيد الموعد.`,
  } : {
    status: 'Request received', title: 'Booking summary', hi: `Hello ${esc(r.patient_name)},`,
    lead: `Thank you for choosing Nile Therapy. We have your booking request, and our team will call you on <b style="font-family:${MONO}">${esc(r.phone)}</b> to confirm the time.`,
    no: 'Request no.', date: 'Requested on', service: 'Service', day: 'Preferred day', time: 'Time', area: 'Address',
    priceL: 'Price', currency: 'EGP', priceNote: 'Pay cash after the session — nothing to pay now', noPrice: 'Confirmed when we call you',
    notChosen: "We'll help you choose", next: 'What happens next',
    steps: [['We call you', 'to agree on the day and time.'], ['We visit you at home', 'a physiotherapist comes to you.'], ['Pay after the session', 'in cash, once the session is done.']],
    wa: 'Message us on WhatsApp', help: 'A question, or need to change the time? Reply to this email or message us on WhatsApp.',
    foot: 'This is a summary of your request, not an invoice. You got it because this email was entered in the booking form on niletherapy.org; if that was not you, please ignore it.',
    pre: `Request #${r.id} — we will call you to confirm the time.`,
  };
  const dir = ar ? 'rtl' : 'ltr', start = ar ? 'right' : 'left', end = ar ? 'left' : 'right';
  const font = ar ? "Tahoma,'Segoe UI',Arial,sans-serif" : "'Segoe UI',Helvetica,Arial,sans-serif";
  const C = { ink: '#0b2e33', teal: '#0f7d74', deep: '#0b4f5c', mint: '#5cc9b5', soft: '#eef7f5', line: '#d9ebe7', muted: '#5f7d7b' };
  const row = (k: string, v: string, last = false) => `<tr>
      <td style="padding:12px 0;${last ? '' : `border-bottom:1px solid ${C.line};`}color:${C.muted};font-size:13px;width:38%;vertical-align:top">${k}</td>
      <td style="padding:12px 0;${last ? '' : `border-bottom:1px solid ${C.line};`}color:${C.ink};font-size:15px;font-weight:700;vertical-align:top">${v}</td></tr>`;
  const step = (n: number, h: string, p: string) => `<tr>
      <td style="width:40px;vertical-align:top;padding:0 0 14px"><div style="width:30px;height:30px;line-height:30px;border-radius:15px;background:${C.teal};color:#fff;text-align:center;font-weight:700;font-family:${MONO};font-size:14px">${n}</div></td>
      <td style="vertical-align:top;padding:4px 0 14px;font-size:14px;color:${C.ink}"><b>${h}</b> <span style="color:${C.muted}">${p}</span></td></tr>`;
  const price = svc
    ? `<div style="font-family:${MONO};font-size:30px;font-weight:700;color:${C.deep};letter-spacing:-0.5px" dir="${dir}">${svc.price.toLocaleString('en-US')}<span style="font-size:15px;font-weight:600;color:${C.teal}"> ${T.currency}</span></div>`
    : `<div style="font-size:17px;font-weight:700;color:${C.deep}">${T.noPrice}</div>`;
  const html = `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${T.title}</title></head>
<body style="margin:0;padding:0;background:#eef5f3">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(T.pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5f3"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:${font};text-align:${start};box-shadow:0 2px 10px rgba(11,79,92,.08)">
  <tr><td style="height:6px;background:${C.teal};font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td align="center" style="padding:28px 28px 8px"><a href="${SITE}"><img src="${SITE}/assets/email/logo.png" width="220" alt="Nile Therapy · نايل ثيرابي" style="display:block;width:220px;max-width:70%;height:auto;border:0"></a></td></tr>
  <tr><td align="center" style="padding:8px 28px 0"><span style="display:inline-block;background:${C.soft};color:${C.teal};border:1px solid ${C.line};border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700">✓ ${T.status}</span></td></tr>
  <tr><td style="padding:22px 32px 6px"><h1 style="margin:0 0 10px;font-size:24px;line-height:1.35;color:${C.ink};font-weight:800">${T.hi}</h1>
    <p style="margin:0;font-size:15px;line-height:1.8;color:#2c4a4d">${T.lead}</p></td></tr>
  <tr><td style="padding:20px 32px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:12px"><tr><td style="padding:6px 20px 8px">
      <div style="padding:12px 0 4px;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${C.teal}">${T.title}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${row(T.no, `<span dir="ltr" style="font-family:${MONO};font-size:17px;color:${C.deep}">#${String(r.id).padStart(5, '0')}</span>`)}
        ${row(T.date, esc(booked))}
        ${row(T.service, svc ? (ar ? svc.ar : svc.en) : T.notChosen)}
        ${row(T.day, esc(day))}
        ${row(T.time, slot)}
        ${row(T.area, `<span style="font-weight:600">${esc(gov)}${r.address ? ' — ' + esc(r.address) : ''}</span>`, true)}
      </table>
    </td></tr>
    <tr><td style="background:${C.soft};border-top:1px solid ${C.line};padding:16px 20px;border-radius:0 0 12px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle"><div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${C.teal}">${T.priceL}</div>
          <div style="font-size:13px;color:${C.muted};margin-top:4px">${T.priceNote}</div></td>
        <td style="vertical-align:middle;text-align:${end};white-space:nowrap">${price}</td></tr></table>
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:26px 32px 4px"><div style="font-size:17px;font-weight:800;color:${C.ink};margin-bottom:14px">${T.next}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${T.steps.map((s, i) => step(i + 1, s[0], s[1])).join('')}</table></td></tr>
  <tr><td align="center" style="padding:8px 32px 6px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:${C.teal}">
      <a href="https://wa.me/${CONTACT.wa}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;font-family:${font}">${T.wa}</a></td></tr></table>
    <p style="margin:14px 0 0;font-size:13px;color:${C.muted};line-height:1.7">${T.help}</p></td></tr>
  <tr><td style="padding:22px 32px 26px"><div style="border-top:1px solid ${C.line};padding-top:18px;text-align:center;font-size:13px;color:${C.muted};line-height:1.9">
    <b style="color:${C.deep}">Nile Therapy · نايل ثيرابي</b><br>
    <span dir="ltr" style="font-family:${MONO}">${CONTACT.phone}</span><br><a href="mailto:${CONTACT.email}" style="color:${C.teal};text-decoration:none">${CONTACT.email}</a> &nbsp;·&nbsp; <a href="${SITE}" style="color:${C.teal};text-decoration:none">niletherapy.org</a>
    <div style="margin-top:12px;font-size:11px;color:#8aa3a1;line-height:1.7">${T.foot}</div></div></td></tr>
</table></td></tr></table></body></html>`;
  const text = [`${T.status} — Nile Therapy`, '', T.hi.replace(/<[^>]+>/g, ''), T.lead.replace(/<[^>]+>/g, ''), '', `${T.no}: #${String(r.id).padStart(5, '0')}`,
    `${T.service}: ${svc ? (ar ? svc.ar : svc.en) : T.notChosen}`, `${T.day}: ${day}`, `${T.time}: ${slot}`, `${T.area}: ${gov}${r.address ? ' — ' + r.address : ''}`,
    `${T.priceL}: ${svc ? `${svc.price} ${T.currency}` : T.noPrice} (${T.priceNote})`, '', T.next,
    ...T.steps.map((s, i) => `${i + 1}. ${s[0]} — ${s[1]}`), '', `WhatsApp: https://wa.me/${CONTACT.wa}`, `${CONTACT.phone} · ${CONTACT.email}`, '', T.foot].join('\n');
  return { subject: `${T.status} #${String(r.id).padStart(5, '0')} — Nile Therapy`, html, text };
}

async function patientEmails(s: Settings) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data } = await admin.from('patient_requests').select('id, patient_name, phone, email, address, governorate, service, preferred_date, preferred_slot, lang, status')
    .eq('source', 'website').neq('email', '').neq('status', 'cancelled').gte('created_at', since).order('id').limit(50);
  const rows = data ?? [];
  for (const id of await unsent('patient', rows.map(r => r.id))) {
    const r = rows.find(x => x.id === id)!;
    const earlier = rows.filter(x => x.email === r.email && x.id < r.id).map(x => String(x.id));
    if (earlier.length) {
      const { count } = await admin.from('email_log').select('id', { count: 'exact', head: true }).eq('kind', 'patient').eq('status', 'sent').in('ref', earlier);
      if ((count ?? 0) >= PATIENT_EMAILS_PER_DAY) continue;
    }
    const mail = patientLayout(r.lang !== 'en', r);
    await deliver(s, 'patient', String(id), [r.email], mail.subject, async () => mail, CONTACT.email);
  }
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
  for (const job of [patientEmails, bookings, referrals, weekly, errorSpike]) {
    try { await job(s); } catch (e) { console.error(job.name, e); }
  }
  return { ok: true };
});
