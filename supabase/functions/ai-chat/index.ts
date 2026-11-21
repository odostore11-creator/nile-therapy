// Each founder's private AI room (ported from buildSystemPrompt / callClaude in server.js v0.1).
//   { action: 'status' }                 -> { connected, models, default }
//   { action: 'send', message, model? }  -> { reply, saved_memory, actions, connected }
//   { action: 'confirm' | 'reject', id } -> { status, result }   (founder clicks a card's button)
//   { action: 'propose', tool, input }   -> { id }  (same as an AI proposal; used for testing; still needs Confirm)
// The Anthropic key is a server secret (ANTHROPIC_API_KEY). Without it, replies are placeholders.
import { admin, asUser, HttpError, type Profile, requireFounder, serve, str } from '../_shared/common.ts';
import { ACTION_KINDS, ACTION_TOOLS, execute, propose, type Proposal } from './actions.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const ANTHROPIC_BASE_URL = Deno.env.get('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com';
const MODELS: Record<string, string> = {
  'claude-sonnet-5-5': 'Sonnet (fast, everyday)',
  'claude-opus-5-5': 'Opus (deep thinking)',
};
const DEFAULT_MODEL = MODELS[Deno.env.get('DEFAULT_MODEL') ?? ''] ? Deno.env.get('DEFAULT_MODEL')! : 'claude-sonnet-5-5';

const TOOLS = [{
  name: 'save_memory',
  description: 'Save a short fact about this founder or their business to long-term memory, so you remember it in future chats.',
  input_schema: { type: 'object', properties: { content: { type: 'string', description: 'One short sentence to remember.' } }, required: ['content'] },
}, ...ACTION_TOOLS];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
function must<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}
const oneLine = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ');

async function buildSystemPrompt(founder: Profile): Promise<string> {
  const now = new Date();
  const since = isoDay(addDays(now, -60));
  const [memories, doctors, stats, recent, appts, acts] = await Promise.all([
    admin.from('founder_memory').select('content, created_at').eq('founder_id', founder.id).order('id'),
    admin.from('profiles').select('id, full_name, username, specialty, area, active').eq('role', 'doctor').order('full_name'),
    admin.from('doctor_stats').select('*'),
    admin.from('sessions')
      .select('id, session_date, session_time, patient_name, session_type, location, duration_min, notes, doctor:profiles!sessions_doctor_id_fkey(username)')
      .gte('session_date', since)
      .order('session_date', { ascending: false }).order('session_time', { ascending: false, nullsFirst: false })
      .limit(400),
    admin.from('appointments')
      .select('id, appt_date, appt_time, patient_name, session_type, location, duration_min, notes, status, doctor:profiles!appointments_doctor_id_fkey(username)')
      .gte('appt_date', isoDay(addDays(now, -7))).lte('appt_date', isoDay(addDays(now, 60)))
      .order('appt_date').order('appt_time', { nullsFirst: true }).limit(300),
    admin.from('ai_actions').select('id, kind, status, result, payload, created_at').eq('founder_id', founder.id).order('id', { ascending: false }).limit(10),
  ]);
  const mem = must(memories), docs = must(doctors), sessions = must(recent), visits = must(appts), actions = must(acts);
  const byDoc = new Map(must(stats).map((s: { doctor_id: string }) => [s.doctor_id, s]));
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Cairo' });

  return `You are the management assistant inside Nile Therapy's private admin portal.
Nile Therapy is an Egyptian physiotherapy (العلاج الطبيعي) agency run by three founders. Its doctors work remotely; every patient session they do comes through Nile Therapy, and they log each session in this portal. There is also a shared schedule of upcoming visits.

You are talking with ${founder.full_name} (${founder.title || 'founder'}). This chat room is private to them. Today is ${weekday} ${isoDay(now)} (Cairo). In Egypt the work week starts on Saturday.
Be a practical partner for management, planning, analysis and brainstorming. Reply in the language the founder writes in (Arabic or English). Be concise and concrete. When you use numbers, base them on the data below and say if the data is incomplete. Never invent sessions, visits or doctors.

## Taking actions
When the founder asks you to change something, use the tools: add_session, update_session, book_appointment, update_appointment (also to cancel a visit), update_doctor.
- Calling a tool only PROPOSES the change. The founder sees a card with Confirm / Cancel. Never say it is done; say you prepared it and they need to press Confirm.
- Refer to doctors by their @username from the list below, and to sessions/visits by their id.
- If something important is missing or ambiguous (which doctor, which date), ask first instead of guessing. Resolve "tomorrow", "next Sunday", etc. from today's date.
- You cannot delete anything, create accounts or reset passwords. Those stay buttons in the portal; tell the founder where.
- Propose one tool call per change; you may propose several changes in one reply.

## What you remember about ${founder.full_name}
${mem.length ? mem.map((m: { content: string; created_at: string }) => `- (${m.created_at.slice(0, 10)}) ${m.content}`).join('\n') : '(nothing saved yet)'}
When the founder tells you something worth remembering for future chats (a preference, a decision, a goal, a fact about the business), call the save_memory tool. Keep each memory short. Don't save trivia or one-off questions.

## Doctors (${docs.length})
${docs.map((d: Record<string, unknown>) => {
    const s = (byDoc.get(d.id as string) ?? {}) as Record<string, unknown>;
    return `- ${d.full_name} [@${d.username}] — ${d.specialty || 'n/a'}, ${d.area || 'n/a'}${d.active ? '' : ' (INACTIVE)'} — sessions total ${s.total ?? 0}, this month ${s.this_month ?? 0}, distinct patients ${s.patients ?? 0}, last ${s.last_session ?? 'never'}`;
  }).join('\n')}

## Schedule: visits from 7 days ago to 60 days ahead (${visits.length})
id | date | time | doctor | patient | type | location | minutes | status | notes
${visits.map((a: Record<string, any>) => [a.id, a.appt_date, (a.appt_time ?? '').slice(0, 5), '@' + (a.doctor?.username ?? ''), a.patient_name, a.session_type, a.location, a.duration_min ?? '', a.status, oneLine(a.notes)].join(' | ')).join('\n') || '(nothing scheduled)'}

## Sessions logged in the last 60 days (${sessions.length}${sessions.length >= 400 ? ', truncated' : ''})
id | date | time | doctor | patient | type | location | minutes | notes
${sessions.map((s: Record<string, any>) => [s.id, s.session_date, (s.session_time ?? '').slice(0, 5), '@' + (s.doctor?.username ?? ''), s.patient_name, s.session_type, s.location, s.duration_min ?? '', oneLine(s.notes)].join(' | ')).join('\n')}

## Your recent proposed actions (newest first)
${actions.map((a: Record<string, any>) => `- #${a.id} ${a.kind} (${a.payload?.target_label ?? ''}) — ${a.status}${a.result ? `: ${a.result}` : ''}`).join('\n') || '(none)'}`;
}

async function saveMemory(founderId: string, content: string) {
  must(await admin.from('founder_memory').insert({ founder_id: founderId, content }));
}

async function saveProposal(founderId: string, p: Proposal): Promise<number> {
  const row = must(await admin.from('ai_actions').insert({ founder_id: founderId, kind: p.kind, payload: p.payload }).select('id').single()) as { id: number };
  return row.id;
}

async function callClaude(founder: Profile, model: string) {
  const history = must(await admin.from('chat_messages').select('role, content').eq('founder_id', founder.id)
    .order('id', { ascending: false }).limit(40)).reverse() as { role: string; content: unknown }[];
  while (history.length && history[0].role !== 'user') history.shift();
  const messages: { role: string; content: unknown }[] = history.map((m) => ({ role: m.role, content: m.content }));
  const system = await buildSystemPrompt(founder);
  const saved: string[] = [];
  const proposed: number[] = [];

  for (let step = 0; step < 6; step++) {
    const r = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2048, system, tools: TOOLS, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(502, `AI error: ${data?.error?.message || r.status}`);
    const content = (data.content ?? []) as { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
    messages.push({ role: 'assistant', content });
    const toolUses = content.filter((c) => c.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !toolUses.length) {
      return { text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() || '(no reply)', saved, proposed };
    }
    const results = [];
    for (const tu of toolUses) {
      if (tu.name === 'save_memory') {
        const text = str(tu.input?.content, 500);
        if (text) { await saveMemory(founder.id, text); saved.push(text); }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: text ? 'Saved.' : 'Empty memory, not saved.', is_error: !text });
      } else if ((ACTION_KINDS as readonly string[]).includes(tu.name ?? '')) {
        try {
          const id = await saveProposal(founder.id, await propose(tu.name!, tu.input ?? {}));
          proposed.push(id);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Proposed as action #${id}. NOT done yet: it waits for the founder to press Confirm.` });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Could not propose: ${(e as Error).message}`, is_error: true });
        }
      } else {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Unknown tool', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: '(stopped after too many tool calls)', saved, proposed };
}

async function placeholderReply(founder: Profile, message: string) {
  const month = isoDay(new Date()).slice(0, 7);
  const [{ count: sessionsThisMonth }, { count: activeDoctors }] = await Promise.all([
    admin.from('sessions').select('id', { count: 'exact', head: true }).gte('session_date', `${month}-01`),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'doctor').eq('active', true),
  ]);
  const saved: string[] = [];
  const m = message.match(/^\s*(remember|تذكر|افتكر)[:\s]+(.+)/is);
  if (m) {
    const text = m[2].trim().slice(0, 500);
    await saveMemory(founder.id, text);
    saved.push(text);
  }
  return {
    text: `**The AI isn't connected yet**: add the \`ANTHROPIC_API_KEY\` secret in Supabase (Edge Functions → Secrets).\n\n` +
      `Your chat room, history and memory are already working, though. Right now I can see **${activeDoctors ?? 0} active doctors** and **${sessionsThisMonth ?? 0} sessions** logged this month.` +
      (saved.length ? `\n\nSaved to your memory: “${saved[0]}”` : `\n\nTip: start a message with "remember:" to test the memory panel.`),
    saved,
    proposed: [] as number[],
  };
}

async function resolveAction(req: Request, founder: Profile, id: number, confirm: boolean) {
  const a = must(await admin.from('ai_actions').select('*').eq('id', id).eq('founder_id', founder.id).maybeSingle()) as Record<string, any> | null;
  if (!a) throw new HttpError(404, 'Action not found');
  if (a.status !== 'pending') throw new HttpError(409, 'This action was already handled');
  // Claim it first so a double click can't run it twice.
  const claimed = must(await admin.from('ai_actions').update({ status: confirm ? 'done' : 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending').select('id')) as unknown[];
  if (!claimed.length) throw new HttpError(409, 'This action was already handled');
  if (!confirm) return { status: 'cancelled', result: null };
  try {
    const result = await execute(asUser(req), a.kind, a.payload);
    await admin.from('ai_actions').update({ result }).eq('id', id);
    return { status: 'done', result };
  } catch (e) {
    const msg = (e as Error).message;
    await admin.from('ai_actions').update({ status: 'failed', result: msg }).eq('id', id);
    return { status: 'failed', result: msg };
  }
}

serve(async (req, body) => {
  const founder = await requireFounder(req);
  const connected = !!ANTHROPIC_API_KEY;

  if (body.action === 'status') return { connected, models: MODELS, default: DEFAULT_MODEL };

  if (body.action === 'confirm' || body.action === 'reject') {
    return await resolveAction(req, founder, Number(body.id), body.action === 'confirm');
  }

  if (body.action === 'propose') {
    const tool = str(body.tool, 40);
    if (!(ACTION_KINDS as readonly string[]).includes(tool)) throw new HttpError(400, 'Unknown action');
    return { id: await saveProposal(founder.id, await propose(tool, (body.input ?? {}) as Record<string, unknown>)) };
  }

  if (body.action === 'send') {
    const message = str(body.message, 20000);
    if (!message) throw new HttpError(400, 'Empty message');
    const model = MODELS[str(body.model, 60)] ? str(body.model, 60) : DEFAULT_MODEL;

    const userRow = must(await admin.from('chat_messages').insert({ founder_id: founder.id, role: 'user', content: message }).select('id').single()) as { id: number };
    let reply;
    try {
      reply = connected ? await callClaude(founder, model) : await placeholderReply(founder, message);
    } catch (e) {
      await admin.from('chat_messages').delete().eq('id', userRow.id); // don't keep a question with no answer
      throw e;
    }
    const answer = must(await admin.from('chat_messages').insert({ founder_id: founder.id, role: 'assistant', content: reply.text, model: connected ? model : 'placeholder' }).select('id').single()) as { id: number };
    if (reply.proposed.length) await admin.from('ai_actions').update({ message_id: answer.id }).in('id', reply.proposed);
    return { reply: reply.text, saved_memory: reply.saved, actions: reply.proposed, connected };
  }

  throw new HttpError(400, 'Unknown action');
});
