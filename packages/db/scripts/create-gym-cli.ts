/* Provision a real gym and its first Owner account.
 *
 * Self-serve onboarding is Phase 9; until then this is how a tenant is created.
 * Safe to run against production — it writes exactly one gym and one owner.
 *
 *   npm run gym:create -- --name "Ironworks Strength" --email you@gym.com
 *
 * Password may be passed with --password; if omitted a strong one is generated
 * and printed once. Change it after first sign-in.
 */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createDb, env, hashPassword, schema, uuidv7 } from '../src/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = arg('name');
const email = arg('email')?.toLowerCase();
const displayName = arg('owner') ?? 'Owner';
const timezone = arg('timezone') ?? 'America/Chicago';
const units = (arg('units') ?? 'lb') as 'lb' | 'kg';
let password = arg('password');
let generated = false;

if (!name || !email) {
  console.error('Usage: npm run gym:create -- --name "Gym Name" --email owner@gym.com [--owner "Full Name"] [--password ...] [--timezone America/Chicago] [--units lb|kg]');
  process.exit(1);
}
if (!password) {
  password = randomBytes(12).toString('base64url');
  generated = true;
}

const slug = (arg('slug') ?? name)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40);

const bundle = createDb(env.DATABASE_ADMIN_URL);
const d = bundle.db;

try {
  const existingGym = await d.select().from(schema.gyms).where(eq(schema.gyms.slug, slug)).limit(1);
  if (existingGym[0]) {
    console.error(`A gym with slug "${slug}" already exists. Pass a different --slug.`);
    process.exit(1);
  }

  const gymId = uuidv7();
  await d.insert(schema.gyms).values({
    id: gymId,
    name,
    slug,
    timezone,
    units,
    settings: {
      adminFinancials: false,
      cancellationWindowHours: 24,
      lateCancelFeeCents: 0,
      noShowFeeCents: 0,
    },
  });

  // reuse the account if this person already exists (one human, many gyms)
  const existingUser = await d.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  let userId = existingUser[0]?.id;
  if (userId) {
    console.log(`Existing account ${email} found — linking it as Owner (password unchanged).`);
    generated = false;
  } else {
    userId = uuidv7();
    await d.insert(schema.users).values({
      id: userId,
      email,
      displayName,
      passwordHash: await hashPassword(password),
    });
  }

  const already = await d
    .select()
    .from(schema.gymStaff)
    .where(and(eq(schema.gymStaff.gymId, gymId), eq(schema.gymStaff.userId, userId)))
    .limit(1);
  if (!already[0]) {
    await d.insert(schema.gymStaff).values({
      id: uuidv7(),
      gymId,
      userId,
      role: 'owner',
      employmentType: 'employee',
    });
  }

  console.log('');
  console.log(`  Gym:    ${name}  (slug: ${slug})`);
  console.log(`  Owner:  ${email}`);
  if (generated) console.log(`  Password: ${password}   <- shown once, change it after signing in`);
  console.log('');
  console.log('Sign in, then use Settings to set branding and Staff to invite your team.');
} finally {
  await bundle.end();
}
