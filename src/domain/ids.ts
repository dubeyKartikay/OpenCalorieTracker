const RANDOM_MASK = (1n << 74n) - 1n;
const LOW_MASK = (1n << 62n) - 1n;

export interface IdGeneratorOptions {
  now?: () => number;
  /** Injection makes fixtures deterministic. IDs are identifiers, never authentication secrets. */
  randomBytes?: () => Uint8Array;
}

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes);
  // Hermes need not expose Web Crypto. Callers may inject platform entropy at composition time.
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** RFC 9562 UUIDv7; lexicographically monotonic even within a millisecond or after clock rollback. */
export function createIdGenerator(options: IdGeneratorOptions = {}): () => string {
  const now = options.now ?? Date.now;
  const entropy = options.randomBytes ?? randomBytes;
  let lastTimestamp = -1;
  let random = 0n;
  return () => {
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
      throw new RangeError('UUIDv7 time must be a nonnegative 48-bit integer in milliseconds');
    }
    if (timestamp > lastTimestamp) {
      const bytes = entropy();
      if (bytes.length !== 10) throw new RangeError('UUIDv7 entropy must contain ten bytes');
      random = bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n) & RANDOM_MASK;
      lastTimestamp = timestamp;
    } else {
      random++;
      if (random > RANDOM_MASK) { random = 0n; lastTimestamp++; }
    }
    if (lastTimestamp > 0xffffffffffff) throw new RangeError('UUIDv7 timestamp exhausted');
    const time = lastTimestamp.toString(16).padStart(12, '0');
    const high = (random >> 62n).toString(16).padStart(3, '0');
    const low = ((random & LOW_MASK) | (2n << 62n)).toString(16).padStart(16, '0');
    return `${time.slice(0, 8)}-${time.slice(8)}-7${high}-${low.slice(0, 4)}-${low.slice(4)}`;
  };
}

export const generateId = createIdGenerator();
