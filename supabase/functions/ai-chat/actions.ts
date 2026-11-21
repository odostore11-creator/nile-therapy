// AI actions: the AI can only PROPOSE a change. It is saved as "pending" and shown to the
// founder with Confirm / Cancel. Only after Confirm is it carried out, using the founder's
// own login (so the database permission rules apply). The AI can never delete anything,
// create accounts or touch passwords.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { admin, HttpError, str } from '../_shared/common.ts';

export const ACTION_KINDS = ['add_session', 'update_session', 'book_appointment', 'update_appointment', 'update_doctor'] as const;
type Kind = typeof ACTION_KINDS[number];
type Fields = Record<string, unknown>;
export type Proposal = { kind: Kind; payload: { target_id?: string | number; target_label?: string; before?: Fields; after: Fields } };

const TYPES = ['Home visit', 'Clinic', 'Online'];
const visitFields = {
  patient_name: { type: 'string', description: 'Patient short name, e.g. "Ahmed S."' },
  location: { type: 'string', description: 'Area / address, or "Video call" for online' },
  session_type: { type: 'string', enum: TYPES },
  duration_min: { type: 'integer', minimum: 0, maximum: 600 },
  notes: { type: 'string' },
};
const date = { type: 'string', description: 'YYYY-MM-DD' };
const time = { type: 'string', description: 'HH:MM, 24-hour' };
const note = 'This only PROPOSES the change; the founder must click Confirm in the chat before anything happens.';

export const ACTION_TOOLS = [
  { name: 'add_session', description: `Log a session that already happened, for a doctor. ${note}`,
    input_schema: { type: 'object', required: ['doctor_username', 'patient_name', 'location', 'session_date'],
      properties: { doctor_username: { type: 'string' }, ...visitFields, session_date: date, session_time: time } } },
  { name: 'update_session', description: `Change details of a logged session (use its id from the sessions list). Only include fields that change. ${note}`,
    input_schema: { type: 'object', required: ['session_id'],
      properties: { session_id: { type: 'integer' }, ...visitFields, session_date: date, session_time: time } } },
  { name: 'book_appointment', description: `Book an upcoming visit on the shared schedule. ${note}`,
    input_schema: { type: 'object', required: ['doctor_username', 'patient_name', 'appt_date'],
      properties: { doctor_username: { type: 'string' }, ...visitFields, appt_date: date, appt_time: time } } },
  { name: 'update_appointment', description: `Move, reassign, edit or cancel a scheduled visit (use its id from the schedule list). To cancel, set status "cancelled". Only include fields that change. ${note}`,
    input_schema: { type: 'object', required: ['appointment_id'],
      properties: { appointment_id: { type: 'integer' }, doctor_username: { type: 'string' }, ...visitFields, appt_date: date, appt_time: time,
        status: { type: 'string', enum: ['planned', 'cancelled'] } } } },
  { name: 'update_doctor', description: `Edit a doctor's profile, or turn their account off/on with "active". Cannot create accounts or change passwords. Only include fields that change. ${note}`,
    input_schema: { type: 'object', required: ['doctor_username'],
      properties: { doctor_username: { type: 'string' }, full_name: { type: 'string' }, title: { type: 'string' }, specialty: { type: 'string' },
        phone: { type: 'string' }, area: { type: 'string' }, bio: { type: 'string' }, active: { type: 'boolean' } } } },
];

// ---------- validation (turns the AI's input into a clean, checked change) ----------
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const isTime = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

async function findDoctor(username: unknown) {
  const u = str(username, 40).toLowerCase().replace(/^@/, '');
  const { data } = await admin.from('profiles').select('id, full_name, username, active').eq('username', u).eq('role', 'doctor').maybeSingle();
  if (!data) throw new HttpError(400, `No doctor with username "${u}"`);
  return data;
}

/** Copies the allowed visit fields from the AI's input, checking each one. */
function visitChanges(input: Fields, dateKey: 'session_date' | 'appt_date', timeKey: 'session_time' | 'appt_time', partial: boolean) {
  const out: Fields = {};
  if ('patient_name' in input) { const v = str(input.patient_name, 120); if (!v) throw new HttpError(400, 'Patient name is empty'); out.patient_name = v; }
  if ('location' in input) out.location = str(input.location, 200);
  if ('session_type' in input) { if (!TYPES.includes(input.session_type as string)) throw new HttpError(400, 'Session type must be Home visit, Clinic or Online'); out.session_type = input.session_type; }
  if ('duration_min' in input && input.duration_min !== null) {
    const n = Number(input.duration_min);
    if (!Number.isInteger(n) || n < 0 || n > 600) throw new HttpError(400, 'Minutes must be 0–600'); out.duration_min = n;
  }
  if ('notes' in input) out.notes = str(input.notes, 2000);
  if (dateKey in input) { if (!isDate(input[dateKey])) throw new HttpError(400, 'Date must be YYYY-MM-DD'); out[dateKey] = input[dateKey]; }
  if (timeKey in input && input[timeKey] !== null && input[timeKey] !== '') { if (!isTime(input[timeKey])) throw new HttpError(400, 'Time must be HH:MM'); out[timeKey] = input[timeKey]; }
  if (!partial && !out[dateKey]) throw new HttpError(400, 'A date is required');
  return out;
}
const pick = (row: Fields, keys: string[]) => Object.fromEntries(keys.map((k) => [k, k.endsWith('_time') && row[k] ? String(row[k]).slice(0, 5) : row[k]]));
function onlyChanged(before: Fields, after: Fields) {
  const changed = Object.fromEntries(Object.entries(after).filter(([k, v]) => String(before[k] ?? '') !== String(v ?? '')));
  if (!Object.keys(changed).length) throw new HttpError(400, 'Nothing would change');
  return changed;
}

export async function propose(kind: string, input: Fields): Promise<Proposal> {
  switch (kind) {
    case 'add_session': {
      const d = await findDoctor(input.doctor_username);
      const after = visitChanges(input, 'session_date', 'session_time', false);
      if (!after.patient_name) throw new HttpError(400, 'Patient name is required');
      if (!after.location) throw new HttpError(400, 'Location is required');
      return { kind, payload: { target_label: d.full_name, after: { doctor_id: d.id, doctor_name: d.full_name, session_type: 'Home visit', ...after } } };
    }
    case 'update_session': {
      const id = Number(input.session_id);
      const { data: s } = await admin.from('sessions').select('*, doctor:profiles!sessions_doctor_id_fkey(full_name)').eq('id', id).maybeSingle();
      if (!s) throw new HttpError(400, `No session with id ${id}`);
      const changes = visitChanges(input, 'session_date', 'session_time', true);
      const before = pick(s, Object.keys(changes));
      return { kind, payload: { target_id: id, target_label: `${s.doctor?.full_name} · ${s.patient_name} · ${s.session_date}`, before, after: onlyChanged(before, changes) } };
    }
    case 'book_appointment': {
      const d = await findDoctor(input.doctor_username);
      const after = visitChanges(input, 'appt_date', 'appt_time', false);
      if (!after.patient_name) throw new HttpError(400, 'Patient name is required');
      return { kind, payload: { target_label: d.full_name, after: { doctor_id: d.id, doctor_name: d.full_name, ...after } } };
    }
    case 'update_appointment': {
      const id = Number(input.appointment_id);
      const { data: a } = await admin.from('appointments').select('*, doctor:profiles!appointments_doctor_id_fkey(full_name)').eq('id', id).maybeSingle();
      if (!a) throw new HttpError(400, `No scheduled visit with id ${id}`);
      if (a.status === 'done') throw new HttpError(400, 'That visit is already done; edit the logged session instead');
      const changes: Fields = visitChanges(input, 'appt_date', 'appt_time', true);
      if ('status' in input) { if (!['planned', 'cancelled'].includes(input.status as string)) throw new HttpError(400, 'Status must be planned or cancelled'); changes.status = input.status; }
      const before: Fields = pick(a, Object.keys(changes));
      if (input.doctor_username) {
        const d = await findDoctor(input.doctor_username);
        changes.doctor_id = d.id; changes.doctor_name = d.full_name;
        before.doctor_id = a.doctor_id; before.doctor_name = a.doctor?.full_name;
      }
      const after = onlyChanged(before, changes);
      if (after.doctor_id === undefined) delete after.doctor_name;
      return { kind, payload: { target_id: id, target_label: `${a.doctor?.full_name} · ${a.patient_name} · ${a.appt_date}`, before, after } };
    }
    case 'update_doctor': {
      const d = await findDoctor(input.doctor_username);
      const { data: full } = await admin.from('profiles').select('*').eq('id', d.id).single();
      const changes: Fields = {};
      const limits: Record<string, number> = { full_name: 120, title: 80, specialty: 120, phone: 40, area: 120, bio: 2000 };
      for (const [k, max] of Object.entries(limits)) if (k in input) changes[k] = str(input[k], max);
      if (changes.full_name === '') throw new HttpError(400, 'Full name cannot be empty');
      if ('active' in input) changes.active = input.active === true;
      const before = pick(full, Object.keys(changes));
      return { kind, payload: { target_id: d.id, target_label: d.full_name, before, after: onlyChanged(before, changes) } };
    }
  }
  throw new HttpError(400, `Unknown action ${kind}`);
}

// ---------- carrying out a confirmed action, as the founder ----------
const dbFields = (after: Fields) => Object.fromEntries(Object.entries(after).filter(([k]) => k !== 'doctor_name'));

export async function execute(db: SupabaseClient, kind: Kind, payload: Proposal['payload']): Promise<string> {
  const after = dbFields(payload.after);
  let r;
  switch (kind) {
    case 'add_session': r = await db.from('sessions').insert(after).select('id').single(); break;
    case 'update_session': r = await db.from('sessions').update(after).eq('id', payload.target_id).select('id'); break;
    case 'book_appointment': r = await db.from('appointments').insert(after).select('id').single(); break;
    case 'update_appointment': r = await db.from('appointments').update(after).eq('id', payload.target_id).select('id'); break;
    case 'update_doctor': r = await db.from('profiles').update(after).eq('id', payload.target_id).eq('role', 'doctor').select('id'); break;
  }
  if (r?.error) throw new HttpError(400, /row-level security|permission denied/i.test(r.error.message) ? 'Not allowed' : r.error.message);
  if (Array.isArray(r?.data) && !r.data.length) throw new HttpError(400, 'Not allowed or no longer exists');
  const id = Array.isArray(r?.data) ? payload.target_id : (r?.data as { id: number })?.id;
  return `ok #${id}`;
}
