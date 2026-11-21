// Public settings for the browser. These are SAFE to publish:
// the publishable key only lets people try to log in; what they can see after that
// is decided by the Row Level Security rules in the database.
// NEVER put the service-role key or the Anthropic API key here.
window.NILE_CONFIG = {
  supabaseUrl: 'https://oppjpgaoucigbukvqoqa.supabase.co',
  supabaseKey: 'sb_publishable_7J1Z49sPwx2bqUBhfZpj4w_6dx0n6U4',
  loginEmailDomain: 'nile.local', // username "dr.mona" logs in as dr.mona@nile.local
};
