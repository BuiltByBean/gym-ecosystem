/** ULID: 26-char Crockford base32, 48-bit ms timestamp + 80-bit randomness.
 *  Lexicographic order == time order. Monotonic within one process so ops
 *  logged in the same millisecond still sort in creation order. */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  // Works in browser, worker, and Node 19+.
  globalThis.crypto.getRandomValues(b);
  return b;
}

let lastTime = 0;
let lastRandom: number[] = [];

export function ulid(now = Date.now()): string {
  let time = now;
  if (time === lastTime) {
    // increment the 80-bit random part to stay monotonic within the ms
    for (let i = 15; i >= 0; i--) {
      const v = lastRandom[i]! + 1;
      if (v <= 31) {
        lastRandom[i] = v;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastTime = time;
    const bytes = randomBytes(16);
    lastRandom = Array.from(bytes, (b) => b & 31).slice(0, 16);
  }

  let out = '';
  for (let i = 9; i >= 0; i--) {
    out = ALPHABET[time % 32]! + out;
    time = Math.floor(time / 32);
  }
  for (let i = 0; i < 16; i++) out += ALPHABET[lastRandom[i]!]!;
  return out;
}

export function isUlid(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
}
