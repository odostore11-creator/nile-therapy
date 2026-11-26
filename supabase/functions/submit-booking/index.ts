// Public booking form on niletherapy.org -> a patient request in the portal (source 'website').
// No login. Protection: strict validation and length limits, a honeypot field, a per-IP rate limit
// (only a salted hash of the IP is stored), the same phone can't book twice within 10 minutes or more than 3 times a day,
// and a site-wide hourly ceiling. With a map pin, the request is auto-assigned like any other; without one, or during an
// unusual burst of bookings, it goes to the founders.
import { admin, HttpError, serve, str } from '../_shared/common.ts';

const GOVERNORATES = ['Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Sharqia', 'Dakahlia', 'Gharbia', 'Monufia', 'Beheira', 'Kafr El Sheikh', 'Damietta',
  'Port Said', 'Ismailia', 'Suez', 'Fayoum', 'Beni Suef', 'Minya', 'Assiut', 'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea', 'New Valley', 'Matrouh',
  'North Sinai', 'South Sinai'];
const SERVICES: Record<string, number> = { '': 45, 'home-assessment': 120, orthopedic: 60, neuro: 120, other: 45 };
const SLOTS = ['any', 'morning', 'afternoon', 'evening'];
const PER_IP_PER_HOUR = 5;
const PHONE_PER_DAY = 3;
const BURST_PER_HOUR = 15;  // more website bookings than this in an hour: stop auto-booking visits, send them to the founders
const MAX_PER_HOUR = 60;    // hard ceiling for the whole site

const MSG = {
  en: { name: 'Enter your full name.', phone: 'Enter a valid Egyptian mobile number.', gov: 'Choose your governorate.', addr: 'Enter your address or area.',
    date: 'Choose a day within the next 3 months.', consent: 'Please agree so we can contact you.', link: 'The map link must start with https://',
    many: 'Too many requests. Please try again later or message us on WhatsApp.' },
  ar: { name: 'اكتب الاسم بالكامل.', phone: 'اكتب رقم موبايل مصري صحيح.', gov: 'اختر المحافظة.', addr: 'اكتب العنوان أو المنطقة.',
    date: 'اختر يوماً خلال الأشهر الثلاثة القادمة.', consent: 'يجب الموافقة لنتمكن من التواصل معك.', link: 'رابط الموقع يجب أن يبدأ بـ https://',
    many: 'طلبات كثيرة. حاول لاحقاً أو راسلنا على واتساب.' },
};

const cairoToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // Egypt is UTC+2 (UTC+3 in summer; a day's slack is fine)
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const inEgypt = (lat: number, lng: number) => lat >= 21 && lat <= 32.5 && lng >= 24 && lng <= 37.5;

/** Egyptian mobile -> 01xxxxxxxxx, or null. */
function cleanPhone(v: string): string | null {
  let d = v.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (d.startsWith('0020')) d = d.slice(4); else if (d.startsWith('20')) d = d.slice(2);
  if (/^1[0125]\d{8}$/.test(d)) d = '0' + d;
  return /^01[0125]\d{8}$/.test(d) ? d : null;
}
/** Coordinates from a pasted maps link (…?q=lat,lng, …@lat,lng, …!3dlat!4dlng). Short links have none. */
function coordsFromLink(link: string): [number, number] | null {
  const m = link.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || link.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || link.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return inEgypt(lat, lng) ? [lat, lng] : null;
}
async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
}

serve(async (req, body) => {
  const lang = body.lang === 'en' ? 'en' : 'ar', m = MSG[lang];
  if (str(body.website, 200)) return { ok: true }; // honeypot filled: a bot. Pretend it worked.

  const name = str(body.name, 120).replace(/\s+/g, ' ');
  const phone = cleanPhone(str(body.phone, 30));
  const governorate = str(body.governorate, 40);
  const address = str(body.address, 300);
  const date = str(body.date, 10);
  const slot = SLOTS.includes(str(body.slot, 20)) ? str(body.slot, 20) : 'any';
  const service = str(body.service, 40) in SERVICES ? str(body.service, 40) : '';
  const complaint = str(body.complaint, 1000);
  const link = str(body.map_link, 500);
  if (name.length < 2) throw new HttpError(400, m.name);
  if (!phone) throw new HttpError(400, m.phone);
  if (!GOVERNORATES.includes(governorate)) throw new HttpError(400, m.gov);
  if (address.length < 3) throw new HttpError(400, m.addr);
  const today = cairoToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < addDays(today, -1) || date > addDays(today, 92)) throw new HttpError(400, m.date);
  if (link && !/^https:\/\/\S+$/i.test(link)) throw new HttpError(400, m.link);
  if (body.consent !== true) throw new HttpError(400, m.consent);
  let lat = Number(body.lat), lng = Number(body.lng);
  if (!(Number.isFinite(lat) && Number.isFinite(lng) && body.lat !== '' && inEgypt(lat, lng))) {
    const c = link ? coordsFromLink(link) : null;
    [lat, lng] = c ?? [NaN, NaN];
  }
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng);

  // Rate limits. CF-Connecting-IP is set by Cloudflare in front of Supabase and can't be faked by the caller
  // (Cloudflare rejects requests that try); the first X-Forwarded-For entry is the fallback (Cloudflare rewrites it too).
  const ip = req.headers.get('cf-connecting-ip')?.trim() || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipHash = await sha256('nile-booking|' + ip);
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const { count: recent } = await admin.from('patient_requests').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', hourAgo);
  if ((recent ?? 0) >= PER_IP_PER_HOUR) throw new HttpError(429, m.many);
  const tenAgo = new Date(Date.now() - 600e3).toISOString();
  const { count: dup } = await admin.from('patient_requests').select('id', { count: 'exact', head: true }).eq('phone', phone).eq('source', 'website').gte('created_at', tenAgo);
  if ((dup ?? 0) > 0) return { ok: true }; // already received (double submit)
  // Same phone at most 3 times a day (a real patient books once; a script reuses numbers).
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const { count: sameDay } = await admin.from('patient_requests').select('id', { count: 'exact', head: true }).eq('phone', phone).eq('source', 'website').gte('created_at', dayAgo);
  if ((sameDay ?? 0) >= PHONE_PER_DAY) throw new HttpError(429, m.many);
  // Site-wide: far more bookings in an hour than the business ever gets means a flood. Past BURST_PER_HOUR they still come in
  // but go to the founders (no auto-booked doctor visits); past MAX_PER_HOUR they are refused.
  const { count: siteHour } = await admin.from('patient_requests').select('id', { count: 'exact', head: true }).eq('source', 'website').gte('created_at', hourAgo);
  if ((siteHour ?? 0) >= MAX_PER_HOUR) throw new HttpError(429, m.many);
  const burst = (siteHour ?? 0) >= BURST_PER_HOUR;
  if (burst) console.warn(`booking burst: ${siteHour} website bookings in the last hour; routing to founders`);

  const notes = [complaint && `Complaint: ${complaint}`, link && `Map: ${link}`, burst ? 'Arrived during an unusual burst of website bookings: check it is real' : '', 'Booked on the website'].filter(Boolean).join(' · ').slice(0, 2000);
  const autoRoute = hasPin && !burst; // without a pin the request goes to the founders instead of being auto-assigned
  const { data, error } = await admin.rpc('create_patient_request', { p: {
    patient_name: name, phone, address, governorate, lat: autoRoute ? lat : '', lng: autoRoute ? lng : '', preferred_date: date < today ? today : date,
    preferred_slot: slot, service, session_type: 'Home visit', duration_min: SERVICES[service], condition: complaint.slice(0, 500), notes,
    source: 'website', lang, ip_hash: ipHash,
  } });
  if (error) { console.error(error); throw new HttpError(500, 'Server error'); }
  return { ok: true, status: (data as Record<string, unknown>)?.status ?? 'new' };
});
