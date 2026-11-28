// Admin actions that need the secret key:
//   { action: 'create', username, full_name, title?, specialty?, phone?, area?, bio? } -> { id, username, password }   founders
//   { action: 'reset_password', doctor_id }                                           -> { username, password }       founders + tech team
//   { action: 'doctor_logins' }                        -> [{ id, full_name, username, active }]                     founders + tech team
//   { action: 'create_partner', username, full_name, kind?, organization?, contact_person?, phone?, email?,
//              governorate?, address?, notes? }                                      -> { id, username, password }   founders + tech team
//   { action: 'reset_partner_password', partner_id }                                  -> { username, password }       founders + tech team
// Passwords are generated here and returned once; they are never stored in plain text.
import { admin, bearer, HttpError, randomPassword, requireFounder, serve, str } from '../_shared/common.ts';

const EMAIL_DOMAIN = 'nile.local';
const PARTNER_KINDS = ['doctor', 'hospital', 'clinic', 'other'];

// Founders or the technical team (role 'tech'), active accounts only.
async function requireFounderOrTech(req: Request) {
  const token = bearer(req);
  if (!token || token.startsWith('sb_')) throw new HttpError(401, 'Please log in');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Please log in again');
  const { data: me } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (!me || !me.active || !['admin', 'tech'].includes(me.role)) throw new HttpError(403, 'Only founders or the technical team can do this');
  return me;
}

// Makes the login + profile; removes the login again if the profile can't be saved.
async function createAccount(username: string, profile: Record<string, unknown>) {
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Username: 3+ characters, letters/numbers/._- only');
  const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  if (taken) throw new HttpError(409, 'That username is taken');
  const password = randomPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`, password, email_confirm: true, app_metadata: { username },
  });
  if (error || !created.user) {
    throw new HttpError(/already/i.test(error?.message ?? '') ? 409 : 500, /already/i.test(error?.message ?? '') ? 'That username is taken' : 'Could not create the account');
  }
  const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, username, ...profile });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    console.error(profileError);
    throw new HttpError(500, 'Could not create the profile');
  }
  return { id: created.user.id, password };
}

async function resetPassword(id: string, role: string, notFound: string) {
  const { data: p } = await admin.from('profiles').select('id, username').eq('id', id).eq('role', role).maybeSingle();
  if (!p) throw new HttpError(404, notFound);
  const password = randomPassword();
  const { error } = await admin.auth.admin.updateUserById(p.id, { password });
  if (error) { console.error(error); throw new HttpError(500, 'Could not reset the password'); }
  await admin.rpc('revoke_user_sessions', { uid: p.id }); // log them out everywhere
  return { username: p.username, password };
}

serve(async (req, body) => {
  if (body.action === 'create_partner' || body.action === 'reset_partner_password') {
    await requireFounderOrTech(req);
    if (body.action === 'reset_partner_password') return resetPassword(str(body.partner_id, 64), 'partner', 'Partner not found');

    const username = str(body.username, 40).toLowerCase();
    const full_name = str(body.full_name, 120);
    if (!full_name) throw new HttpError(400, 'Name is required');
    const kind = PARTNER_KINDS.includes(str(body.kind, 20)) ? str(body.kind, 20) : 'doctor';
    const { id, password } = await createAccount(username, { role: 'partner', full_name, title: 'Partner', phone: str(body.phone, 40) });
    const { error } = await admin.from('partner_profiles').insert({
      id, kind, organization: str(body.organization, 160), contact_person: str(body.contact_person, 120), phone: str(body.phone, 40),
      email: str(body.email, 160), governorate: str(body.governorate, 40), address: str(body.address, 300), notes: str(body.notes, 1000),
    });
    if (error) { await admin.auth.admin.deleteUser(id); console.error(error); throw new HttpError(500, 'Could not create the partner'); }
    return { id, username, password };
  }

  // Doctors can't change their own password: they ask a founder or the technical team, who reset it here.
  if (body.action === 'reset_password' || body.action === 'doctor_logins') {
    await requireFounderOrTech(req);
    if (body.action === 'reset_password') return resetPassword(str(body.doctor_id, 64), 'doctor', 'Doctor not found');
    const { data, error } = await admin.from('profiles').select('id, full_name, username, active').eq('role', 'doctor')
      .order('active', { ascending: false }).order('full_name');
    if (error) { console.error(error); throw new HttpError(500, 'Could not load doctors'); }
    return data;
  }

  await requireFounder(req);

  if (body.action === 'create') {
    const username = str(body.username, 40).toLowerCase();
    const full_name = str(body.full_name, 120);
    if (!full_name) throw new HttpError(400, 'Full name is required');
    const { id, password } = await createAccount(username, {
      role: 'doctor', full_name,
      title: str(body.title, 80) || 'Physiotherapist', specialty: str(body.specialty, 120),
      phone: str(body.phone, 40), area: str(body.area, 120), bio: str(body.bio, 2000),
    });
    return { id, username, password };
  }

  throw new HttpError(400, 'Unknown action');
});
