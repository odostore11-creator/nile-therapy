// Founder-only admin actions that need the secret key:
//   { action: 'create', username, full_name, title?, specialty?, phone?, area?, bio? } -> { id, username, password }
//   { action: 'reset_password', doctor_id }                                           -> { username, password }
// Passwords are generated here and returned once; they are never stored in plain text.
import { admin, HttpError, randomPassword, requireFounder, serve, str } from '../_shared/common.ts';

const EMAIL_DOMAIN = 'nile.local';

serve(async (req, body) => {
  await requireFounder(req);

  if (body.action === 'create') {
    const username = str(body.username, 40).toLowerCase();
    const full_name = str(body.full_name, 120);
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Username: 3+ characters, letters/numbers/._- only');
    if (!full_name) throw new HttpError(400, 'Full name is required');
    const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) throw new HttpError(409, 'That username is taken');

    const password = randomPassword();
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${username}@${EMAIL_DOMAIN}`, password, email_confirm: true, app_metadata: { username },
    });
    if (error || !created.user) {
      throw new HttpError(/already/i.test(error?.message ?? '') ? 409 : 500, /already/i.test(error?.message ?? '') ? 'That username is taken' : 'Could not create the account');
    }
    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id, username, role: 'doctor', full_name,
      title: str(body.title, 80) || 'Physiotherapist', specialty: str(body.specialty, 120),
      phone: str(body.phone, 40), area: str(body.area, 120), bio: str(body.bio, 2000),
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id); // don't leave a half-made account
      console.error(profileError);
      throw new HttpError(500, 'Could not create the doctor profile');
    }
    return { id: created.user.id, username, password };
  }

  if (body.action === 'reset_password') {
    const doctorId = str(body.doctor_id, 64);
    const { data: d } = await admin.from('profiles').select('id, username').eq('id', doctorId).eq('role', 'doctor').maybeSingle();
    if (!d) throw new HttpError(404, 'Doctor not found');
    const password = randomPassword();
    const { error } = await admin.auth.admin.updateUserById(d.id, { password });
    if (error) { console.error(error); throw new HttpError(500, 'Could not reset the password'); }
    await admin.rpc('revoke_user_sessions', { uid: d.id }); // log them out everywhere, like v0.1
    return { username: d.username, password };
  }

  throw new HttpError(400, 'Unknown action');
});
