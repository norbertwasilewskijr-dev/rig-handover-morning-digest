import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isNight, readNight } from '../src/digest/readNight.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-readnight-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function night(lines: string): string {
  writeFileSync(join(dir, '2026-11-01.jsonl'), lines);
  return dir;
}

const rec = (fields: Record<string, unknown>): string =>
  JSON.stringify({ at: '2026-11-01T23:00:00+01:00', job: 'a', status: 'ok', owner: 'rook', ...fields });

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = readNight('runs', '2026-10-28');

  it('finds five jobs, sorted, and one bad line', () => {
    expect(digest?.night).toBe('2026-10-28');
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('aggregates every row', () => {
    expect(digest?.rows).toEqual([
      {
        job: 'digest/render', owner: null, runs: 1, retries: 0, fails: 0, lastStatus: 'ok',
        lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
      },
      {
        job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, fails: 0, lastStatus: 'ok',
        lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, fails: 0, lastStatus: 'ok',
        lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
      },
      {
        job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, fails: 1, lastStatus: 'fail',
        lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
      },
      {
        job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, fails: 0, lastStatus: 'ok',
        lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
      },
    ]);
  });
});

describe('readNight', () => {
  it('returns null only for a missing file', () => {
    expect(readNight(dir, '2026-11-01')).toBeNull();
  });

  it('reads an empty file as no rows', () => {
    expect(readNight(night(''), '2026-11-01')).toEqual({ night: '2026-11-01', rows: [], badLines: 0 });
  });

  it('propagates IO errors other than a missing file', () => {
    mkdirSync(join(dir, '2026-11-01.jsonl'));
    expect(() => readNight(dir, '2026-11-01')).toThrow(/EISDIR/);
  });

  it('rejects invalid nights and traversal before touching disk', () => {
    for (const bad of ['../etc/passwd', '2026-10-28/../x', '2026-13-01', '2026-02-30', '26-10-28', '2026-10-28 ', '']) {
      expect(isNight(bad)).toBe(false);
      expect(() => readNight(dir, bad)).toThrow(Error);
    }
    expect(isNight('2028-02-29')).toBe(true);
    expect(isNight('2026-02-29')).toBe(false);
  });

  it('counts a recovered fail and keeps its error', () => {
    const d = readNight(night([rec({ status: 'fail', error: 'boom' }), rec({ status: 'ok' })].join('\n')), '2026-11-01');
    expect(d?.rows[0]).toMatchObject({ runs: 2, fails: 1, lastStatus: 'ok', lastError: 'boom' });
  });

  it('takes owner and status from the last valid record', () => {
    const d = readNight(
      night([rec({ owner: 'rook' }), rec({ owner: null, status: 'retry' }), '{oops'].join('\n')),
      '2026-11-01',
    );
    expect(d?.rows[0]).toMatchObject({ owner: null, lastStatus: 'retry', retries: 1, runs: 2 });
    expect(d?.badLines).toBe(1);
  });

  it('keeps first and last time in file order with their offsets', () => {
    const d = readNight(
      night([
        rec({ at: '2026-11-02T01:00:00+02:00' }),
        rec({ at: '2026-11-01T23:30:00Z' }),
        rec({ at: '2026-11-01T22:00:00-05:00' }),
      ].join('\n')),
      '2026-11-01',
    );
    expect(d?.rows[0]).toMatchObject({ firstAt: '2026-11-02T01:00:00+02:00', lastAt: '2026-11-01T22:00:00-05:00' });
  });

  it('sorts jobs lexically', () => {
    const d = readNight(night(['b', 'B', 'a/z', 'a'].map((job) => rec({ job })).join('\n')), '2026-11-01');
    expect(d?.rows.map((r) => r.job)).toEqual(['B', 'a', 'a/z', 'b']);
  });

  it('counts malformed records as bad lines', () => {
    const bad = [
      'not json',
      'null',
      '[]',
      '"text"',
      rec({ at: '2026-11-01T23:00:00' }),
      rec({ at: '2026-11-01 23:00:00+01:00' }),
      rec({ at: '2026-02-30T23:00:00+01:00' }),
      rec({ at: '2026-11-01T24:00:00Z' }),
      rec({ at: 1 }),
      rec({ job: '' }),
      rec({ job: 3 }),
      rec({ owner: 7 }),
      rec({ owner: undefined }),
      rec({ status: 'done' }),
      rec({ error: null }),
      rec({ error: 5 }),
    ];
    const d = readNight(night([...bad, rec({})].join('\n')), '2026-11-01');
    expect(d?.badLines).toBe(bad.length);
    expect(d?.rows).toHaveLength(1);
    expect(d?.rows[0]?.lastError).toBeNull();
  });

  it('ignores the terminal newline but counts blank lines inside the file', () => {
    expect(readNight(night(`${rec({})}\n`), '2026-11-01')?.badLines).toBe(0);
    expect(readNight(night(`${rec({})}\n\n${rec({})}\n`), '2026-11-01')?.badLines).toBe(1);
    expect(readNight(night(`${rec({})}\n\n`), '2026-11-01')?.badLines).toBe(1);
  });
});
