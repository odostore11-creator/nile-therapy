// Each founder's private AI room (ported from buildSystemPrompt / callClaude in server.js v0.1).
//   { action: 'status' }                 -> { connected, models, default }
//   { action: 'send', message, model? }  -> { reply, saved_memory, connected }
// The Anthropic key is a server secret (ANTHROPIC_API_KEY). Without it, replies are placeholders.
import { admin, HttpError, type Profile, requireFounder, serve, str } from '../_shared/common.ts';

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
}];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function must<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

async function buildSystemPrompt(founder: Profile): Promise<string> {
  const since = isoDay(new Date(Date.now() - 60 * 86400000));
  const [memories, doctors, stats, recent] = await Promise.all([
    admin.from('founder_memory').select('content, created_at').eq('founder_id', founder.id).order('id'),
    admin.from('profiles').select('id, full_name, username, specialty, area, active').eq('role', 'doctor').order('full_name'),
    admin.from('doctor_stats').select('*'),
    admin.from('sessions')
      .select('session_date, session_time, patient_name, session_type, location, duration_min, notes, doctor:profiles!sessions_doctor_id_fkey(full_name)')
      .gte('session_date', since)
      .order('session_date', { ascending: false }).order('session_time', { ascending: false, nullsFirst: false })
      .limit(400),
  ]);
  const mem = must(memories), docs = must(doctors), sessions = must(recent);
  const byDoc = new Map(must(stats).map((s: { doctor_id: string }) => [s.doctor_id, s]));
  const today = isoDay(new Date());

  return `You are the management assistant inside Nile Therapy's private admin portal.
Nile Therapy is an Egyptian physiotherapy (العلاج الطبيعي) agency run by three founders. Its doctors work remotely; every patient session they do comes through Nile Therapy, and they log each session in this portal.

You are talking with ${founder.full_name} (${founder.title || 'founder'}). This chat room is private to them. Today is ${today}.
Be a practical partner for management, planning, analysis and brainstorming. Reply in the language the founder writes in (Arabic or English). Be concise and concrete. When you use numbers, base them on the data below and say if the data is incomplete. Never invent sessions or doctors.

## What you remember about ${founder.full_name}
${mem.length ? mem.map((m: { content: string; created_at: string }) => `- (${m.created_at.slice(0, 10)}) ${m.content}`).join('\n') : '(nothing saved yet)'}
When the founder tells you something worth remembering for future chats (a preference, a decision, a goal, a fact about the business), call the save_memory tool. Keep each memory short. Don't save trivia or one-off questions.

## Doctors (${docs.length})
${docs.map((d: Record<string, unknown>) => {
    const s = (byDoc.get(d.id as string) ?? {}) as Record<string, unknown>;
    return `- ${d.full_name} [@${d.username}] — ${d.specialty || 'n/a'}, ${d.area || 'n/a'}${d.active ? '' : ' (INACTIVE)'} — sessions total ${s.total ?? 0}, this month ${s.this_month ?? 0}, distinct patients ${s.patients ?? 0}, last ${s.last_session ?? 'never'}`;
  }).join('\n')}

## Sessions logged in the last 60 days (${sessions.length}${sessions.length >= 400 ? ', truncated' : ''})
date | time | doctor | patient | type | location | minutes | notes
${sessions.map((s: Record<string, any>) => [s.session_date, (s.session_time ?? '').slice(0, 5), s.doctor?.full_name ?? '', s.patient_name, s.session_type, s.location, s.duration_min ?? '', String(s.notes ?? '').replace(/\s+/g, ' ')].join(' | ')).join('\n')}`;
}

async function saveMemory(founderId: string, content: string) {
  must(await admin.from('founder_memory').insert({ founder_id: founderId, content }));
}

async function callClaude(founder: Profile, model: string) {
  const history = must(await admin.from('chat_messages').select('role, content').eq('founder_id', founder.id)
    .order('id', { ascending: false }).limit(40)).reverse() as { role: string; content: unknown }[];
  while (history.length && history[0].role !== 'user') history.shift();
  const messages: { role: string; content: unknown }[] = history.map((m) => ({ role: m.role, content: m.content }));
  const system = await buildSystemPrompt(founder);
  const saved: string[] = [];

  for (let step = 0; step < 4; step++) {
    const r = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2048, system, tools: TOOLS, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(502, `AI error: ${data?.error?.message || r.status}`);
    const content = (data.content ?? []) as { type: string; text?: string; id?: string; name?: string; input?: { content?: string } }[];
    messages.push({ role: 'assistant', content });
    const toolUses = content.filter((c) => c.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !toolUses.length) {
      return { text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() || '(no reply)', saved };
    }
    const results = [];
    for (const t of toolUses) {
      const text = str(t.input?.content, 500);
      if (t.name === 'save_memory' && text) {
        await saveMemory(founder.id, text);
        saved.push(text);
        results.push({ type: 'tool_result', tool_use_id: t.id, content: 'Saved.' });
      } else {
        results.push({ type: 'tool_result', tool_use_id: t.id, content: 'Unknown tool', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: '(stopped after too many tool calls)', saved };
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
  };
}

serve(async (req, body) => {
  const founder = await requireFounder(req);
  const connected = !!ANTHROPIC_API_KEY;

  if (body.action === 'status') return { connected, models: MODELS, default: DEFAULT_MODEL };

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
    must(await admin.from('chat_messages').insert({ founder_id: founder.id, role: 'assistant', content: reply.text, model: connected ? model : 'placeholder' }));
    return { reply: reply.text, saved_memory: reply.saved, connected };
  }

  throw new HttpError(400, 'Unknown action');
});
