import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env.js';

// App-layer envelope encryption for sensitive columns (PAR-Q answers, injury notes).
// Separate from disk-level encryption: a DB dump alone reveals nothing.
// v1 uses a single master key from the environment; the "v1:" prefix leaves room
// for per-gym DEKs (key id in the envelope) without a data migration.

const key = createHash('sha256').update(env.SENSITIVE_DATA_KEY).digest();

export function encryptSensitive(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, enc]).toString('base64')}`;
}

export function decryptSensitive<T = unknown>(envelope: string): T {
  if (!envelope.startsWith('v1:')) throw new Error('unknown encryption envelope version');
  const raw = Buffer.from(envelope.slice(3), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8')) as T;
}
