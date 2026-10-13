import { createClient } from '@supabase/supabase-js';
import { readFile, rm } from 'node:fs/promises';
let fixture;
try {
  fixture = JSON.parse(await readFile('.runtime/auth-fixture.json', 'utf8'));
} catch (error) {
  if (error.code === 'ENOENT') process.exit(0);
  throw new Error('Could not read acceptance fixture.');
}
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error: lookup } = await admin.auth.admin.getUserById(fixture.user_id);
if (lookup || !data.user?.user_metadata.acceptance_fixture || data.user.email !== fixture.email)
  throw new Error('Refusing to delete an account without the acceptance fixture marker.');
const { error } = await admin.auth.admin.deleteUser(fixture.user_id);
if (error) throw new Error('Could not clean up synthetic acceptance account.');
await rm('.runtime/auth-fixture.json');
console.log('Synthetic acceptance account removed.');
