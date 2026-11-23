import { describe, expect, it } from 'vitest';
import { createIdGenerator, generateId } from '../ids';
import { diaryEntrySnapshotSchema } from '../schemas';
import { entry } from './fixtures';

describe('UUIDv7', () => {
  it('encodes version, variant and the 48-bit timestamp', () => {
    const generate = createIdGenerator({ now: () => 1_700_000_000_000, randomBytes: () => new Uint8Array(10) });
    const id = generate();
    expect(id).toBe('018bcfe5-6800-7000-8000-000000000000');
    expect(diaryEntrySnapshotSchema.parse(entry({ id })).id).toBe(id);
  });
  it('is deterministic when the clock and entropy are injected', () => {
    const options = { now: () => 123456, randomBytes: () => new Uint8Array(10).fill(17) };
    const a = createIdGenerator(options);
    const b = createIdGenerator(options);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('generates unique monotonic ids within the same millisecond', () => {
    const generate = createIdGenerator({ now: () => 123, randomBytes: () => new Uint8Array(10) });
    const ids = Array.from({ length: 10000 }, generate);
    expect(new Set(ids).size).toBe(10000);
    expect(ids).toEqual([...ids].sort());
  });
  it('remains monotonic after clock rollback', () => {
    let now = 100;
    const generate = createIdGenerator({ now: () => now, randomBytes: () => new Uint8Array(10) });
    const first = generate();
    now = 90;
    const second = generate();
    now = 101;
    const third = generate();
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
    expect(second.slice(0, 13)).toBe(first.slice(0, 13));
  });
  it('advances logical time on entropy overflow', () => {
    const generate = createIdGenerator({ now: () => 100, randomBytes: () => new Uint8Array(10).fill(255) });
    const first = generate();
    const second = generate();
    expect(second > first).toBe(true);
    expect(second.startsWith('00000000-0065-')).toBe(true);
  });
  it.each([-1, NaN, Infinity, 1.5, 0x1000000000000])('rejects invalid time %s', (now) => {
    expect(() => createIdGenerator({ now: () => now })()).toThrow();
  });
  it('rejects malformed injected entropy', () => {
    expect(() => createIdGenerator({ randomBytes: () => new Uint8Array(1) })()).toThrow();
  });
  it('offers a ready-to-use generator with valid version/variant bits', () => {
    expect(generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
