// Test-only account setup. Confirm via an admin-generated link; no email is sent.
// This verifies Auth account/confirmation/login APIs, not SMTP delivery.
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
const url = process.env.SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publicKey || !secret)
  throw new Error('Fixture requires server-only Supabase configuration.');
const email = `atoms-acceptance-${randomUUID()}@example.com`;
const password = randomBytes(24).toString('base64url');
if (process.env.GITHUB_ACTIONS === 'true') {
  console.log(`::add-mask::${email}`);
  console.log(`::add-mask::${password}`);
}
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const auth = createClient(url, publicKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: link, error: created } = await admin.auth.admin.generateLink({
  type: 'signup',
  email,
  password,
  options: { data: { display_name: 'Atoms Acceptance', acceptance_fixture: true } },
});
if (created)
  throw new Error(`Fixture signup could not be prepared (${created.code || created.status}).`);
// Write the identity before confirmation so teardown can remove it on a later failure.
await mkdir('.runtime', { recursive: true, mode: 0o700 });
await writeFile(
  '.runtime/auth-fixture.json',
  JSON.stringify({ email, password, user_id: link.user.id }),
  { mode: 0o600 },
);
const { data: confirmed, error: confirmation } = await auth.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'signup',
});
if (confirmation || !confirmed.user?.email_confirmed_at)
  throw new Error('Signup confirmation failed.');
const { data: login, error: signedIn } = await auth.auth.signInWithPassword({ email, password });
if (signedIn || login.user?.id !== confirmed.user.id) throw new Error('Fixture login failed.');
await auth.auth.signOut();
await mkdir('.artifacts', { recursive: true });
await writeFile(
  '.artifacts/auth-verification.json',
  JSON.stringify(
    {
      signup_account_created: true,
      confirmation_api: true,
      password_login_api: true,
      email_delivery_verified: false,
      public_signup_submission_verified: false,
      ui_login: false,
      session_refresh: false,
      logout: false,
      registration_form: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    signup_account_created: true,
    confirmation_api: true,
    password_login: true,
    email_delivery_verified: false,
    credentials_file: '.runtime/auth-fixture.json',
  }),
);
