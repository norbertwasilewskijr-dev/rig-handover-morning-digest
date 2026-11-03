import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const NIGHT = '2026-11-01';
const EMPTY_NIGHT = '2026-11-02';
const BAD_NIGHT = '2026-11-03';
const INVALID_RECORD_NIGHT = '2026-11-04';
const EM_DASH = '—';

const rec = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });

const mainLog = [
  rec('2026-11-01T23:10:00+01:00', 'sync/retry-two', 'retry', 'rook', 'lock held'),
  rec('2026-11-01T23:00:00-05:00', 'zeta/recovered', 'fail', 'lane-07', 'quota exceeded'),
  rec('2026-11-01T23:20:00+01:00', 'sync/retry-two', 'retry', 'rook', 'lock held'),
  rec('2026-11-01T23:30:00+01:00', 'sync/retry-two', 'ok', 'rook'),
  rec('2026-11-02T00:01:00+01:00', 'Upper/first', 'ok', 'rook'),
  rec('2026-11-02T00:02:00+01:00', 'sync/retry-three', 'retry', 'rook', 'upstream 503'),
  rec('2026-11-02T00:03:00+01:00', 'sync/retry-three', 'retry', 'rook', 'upstream 503'),
  rec('2026-11-02T00:04:00+01:00', 'sync/retry-three', 'retry', 'rook', 'upstream 504'),
  rec('2026-11-02T00:05:00+01:00', 'sync/retry-three', 'ok', 'rook'),
  rec('2026-11-02T01:00:00+01:00', 'zeta/recovered', 'ok', 'lane-07'),
  rec('2026-11-02T01:30:00+01:00', 'digest/null-owner', 'ok', null),
  rec('2026-11-02T02:00:00+01:00', 'owner/changes', 'ok', 'first-owner'),
  rec('2026-11-02T02:10:00+01:00', 'owner/changes', 'ok', 'last-owner'),
].join('\n') + '\n';

type Row = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  fails: number;
  lastStatus: string;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

// Lexical (code unit) order: 'Upper/first' < 'digest/...' < 'owner/...' < 'sync/...' < 'zeta/...'.
const expectedRows: Row[] = [
  { job: 'Upper/first', owner: 'rook', runs: 1, retries: 0, fails: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-11-02T00:01:00+01:00', lastAt: '2026-11-02T00:01:00+01:00' },
  { job: 'digest/null-owner', owner: null, runs: 1, retries: 0, fails: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-11-02T01:30:00+01:00', lastAt: '2026-11-02T01:30:00+01:00' },
  { job: 'owner/changes', owner: 'last-owner', runs: 2, retries: 0, fails: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-11-02T02:00:00+01:00', lastAt: '2026-11-02T02:10:00+01:00' },
  { job: 'sync/retry-three', owner: 'rook', runs: 4, retries: 3, fails: 0, lastStatus: 'ok', lastError: 'upstream 504', firstAt: '2026-11-02T00:02:00+01:00', lastAt: '2026-11-02T00:05:00+01:00' },
  { job: 'sync/retry-two', owner: 'rook', runs: 3, retries: 2, fails: 0, lastStatus: 'ok', lastError: 'lock held', firstAt: '2026-11-01T23:10:00+01:00', lastAt: '2026-11-01T23:30:00+01:00' },
  // First in file order has the later wall-clock instant: file order wins, offsets unchanged.
  { job: 'zeta/recovered', owner: 'lane-07', runs: 2, retries: 0, fails: 1, lastStatus: 'ok', lastError: 'quota exceeded', firstAt: '2026-11-01T23:00:00-05:00', lastAt: '2026-11-02T01:00:00+01:00' },
];

const marked = new Set(['sync/retry-three', 'zeta/recovered']);

let runsDir: string;
let savedMarker: string | undefined;

function makeApp(dir = runsDir) {
  return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir });
}

function writeNight(night: string, content: string, dir = runsDir) {
  writeFileSync(join(dir, `${night}.jsonl`), content);
}

const strip = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

function tableRows(html: string): { raw: string; cells: string[] }[] {
  const trs = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  return trs.map((raw) => ({
    raw,
    cells: [...raw.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1])),
  }));
}

// The digest table is the one whose header row names the job column.
function digestTable(html: string) {
  const all = tableRows(html);
  const headerAt = all.findIndex((r) => r.cells[0]?.toLowerCase() === 'job');
  expect(headerAt, 'digest table with a "job" header').toBeGreaterThanOrEqual(0);
  return { header: all[headerAt], body: all.slice(headerAt + 1) };
}

beforeEach(() => {
  savedMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = 'TEST-MARKER';
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeNight(NIGHT, mainLog);
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
  if (savedMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = savedMarker;
});

describe('GET /api/digest/:night', () => {
  it('returns exact rows in lexical job order with file-order aggregation', async () => {
    const res = await makeApp().request(`/api/digest/${NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: NIGHT, rows: expectedRows, badLines: 0 });
  });

  it('returns 404 for a night with no file', async () => {
    const res = await makeApp().request('/api/digest/2026-11-09');
    expect(res.status).toBe(404);
  });

  it('returns 200 with empty rows for an empty file', async () => {
    writeNight(EMPTY_NIGHT, '');
    const res = await makeApp().request(`/api/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY_NIGHT, rows: [], badLines: 0 });
  });

  it('counts a malformed JSON line and keeps the rest of the night', async () => {
    writeNight(
      BAD_NIGHT,
      [rec('2026-11-03T01:00:00+01:00', 'a/job', 'ok', 'rook'), '{not json', rec('2026-11-03T02:00:00+01:00', 'a/job', 'ok', 'rook')].join('\n') + '\n',
    );
    const body = (await (await makeApp().request(`/api/digest/${BAD_NIGHT}`)).json()) as { rows: Row[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.rows).toEqual([
      { job: 'a/job', owner: 'rook', runs: 2, retries: 0, fails: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-11-03T01:00:00+01:00', lastAt: '2026-11-03T02:00:00+01:00' },
    ]);
  });

  it('counts invalid records (wrong shape or status) as bad lines, not rows', async () => {
    writeNight(
      INVALID_RECORD_NIGHT,
      [
        rec('2026-11-04T01:00:00+01:00', 'a/job', 'ok', 'rook'),
        rec('2026-11-04T01:10:00+01:00', 'a/job', 'exploded', 'rook'),
        JSON.stringify({ at: '2026-11-04T01:20:00+01:00', status: 'ok', owner: 'rook' }),
        JSON.stringify({ job: 'a/job', status: 'ok', owner: 'rook' }),
        JSON.stringify([1, 2]),
        'null',
      ].join('\n') + '\n',
    );
    const body = (await (await makeApp().request(`/api/digest/${INVALID_RECORD_NIGHT}`)).json()) as { rows: Row[]; badLines: number };
    expect(body.badLines).toBe(5);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ job: 'a/job', runs: 1, lastStatus: 'ok' });
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', 'not-a-night', '..%2Fpackage', '..%2F..%2Fetc%2Fpasswd', '%2e%2e%2f%2e%2e%2fpackage'])(
    'returns 404 for invalid night %s',
    async (night) => {
      const res = await makeApp().request(`/api/digest/${night}`);
      expect(res.status).toBe(404);
    },
  );
});

describe('GET /digest/:night', () => {
  it('renders every row with the same values and order as the JSON', async () => {
    const app = makeApp();
    const res = await app.request(`/digest/${NIGHT}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('TEST-MARKER');

    const { header, body } = digestTable(html);
    const headers = header.cells.map((c) => c.toLowerCase());
    for (const col of ['job', 'owner', 'runs', 'retries', 'fails']) expect(headers).toContain(col);
    expect(headers.some((h) => h.includes('last status'))).toBe(true);
    expect(headers.some((h) => h.includes('last error'))).toBe(true);
    expect(headers.filter((h) => /first|last/.test(h) && !/status|error/.test(h))).toHaveLength(2);

    expect(body).toHaveLength(expectedRows.length);
    const json = (await (await app.request(`/api/digest/${NIGHT}`)).json()) as { rows: Row[] };
    expect(body.map((r) => r.cells[0])).toEqual(json.rows.map((r) => r.job));

    body.forEach((r, i) => {
      const e = expectedRows[i];
      expect(r.cells).toEqual([
        e.job,
        e.owner ?? EM_DASH,
        String(e.runs),
        String(e.retries),
        String(e.fails),
        e.lastStatus,
        e.lastError ?? EM_DASH,
        e.firstAt,
        e.lastAt,
      ]);
    });
  });

  it('marks retries >= 3 and any fail (even after recovery), and nothing else', async () => {
    const html = await (await makeApp().request(`/digest/${NIGHT}`)).text();
    const { body } = digestTable(html);
    for (const r of body) {
      const job = r.cells[0];
      expect(/warn/.test(r.raw), `${job} marked`).toBe(marked.has(job));
    }
  });

  it('shows the em dash for a null owner and keeps the row', async () => {
    const html = await (await makeApp().request(`/digest/${NIGHT}`)).text();
    const row = digestTable(html).body.find((r) => r.cells[0] === 'digest/null-owner');
    expect(row?.cells[1]).toBe(EM_DASH);
    expect(row?.cells[6]).toBe(EM_DASH);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await makeApp().request('/digest/2026-11-09');
    expect(res.status).toBe(404);
  });

  it('renders "nothing ran" with 200 for an empty file', async () => {
    writeNight(EMPTY_NIGHT, '');
    const res = await makeApp().request(`/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('nothing ran');
    expect(html).toContain('TEST-MARKER');
  });

  it('shows the bad-line count in text for a night with a malformed line', async () => {
    writeNight(BAD_NIGHT, [rec('2026-11-03T01:00:00+01:00', 'a/job', 'ok', 'rook'), '{not json'].join('\n') + '\n');
    const res = await makeApp().request(`/digest/${BAD_NIGHT}`);
    expect(res.status).toBe(200);
    const text = strip(await res.text());
    expect(text).toMatch(/\b1\b[^.\n]*bad line|bad lines?\D{0,10}\b1\b/i);
    expect(text).toContain('a/job');
  });

  it('shows the bad-line count for invalid records', async () => {
    writeNight(INVALID_RECORD_NIGHT, [rec('2026-11-04T01:00:00+01:00', 'a/job', 'exploded', 'rook'), JSON.stringify({ job: 'x' })].join('\n') + '\n');
    const res = await makeApp().request(`/digest/${INVALID_RECORD_NIGHT}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('nothing ran');
    expect(strip(html)).toMatch(/\b2\b[^.\n]*bad line|bad lines?\D{0,10}\b2\b/i);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', 'not-a-night', '..%2Fpackage', '..%2F..%2Fetc%2Fpasswd', '%2e%2e%2f%2e%2e%2fpackage'])(
    'returns 404 for invalid night %s',
    async (night) => {
      const res = await makeApp().request(`/digest/${night}`);
      expect(res.status).toBe(404);
    },
  );
});

describe('status board digest links', () => {
  it('links each night on disk to its digest with exact ok / retry / fail counts', async () => {
    const second = '2026-10-31';
    writeNight(
      second,
      [
        rec('2026-10-31T01:00:00+01:00', 'a/job', 'ok', 'rook'),
        rec('2026-10-31T02:00:00+01:00', 'a/job', 'fail', 'rook', 'boom'),
        rec('2026-10-31T03:00:00+01:00', 'a/job', 'ok', 'rook'),
        rec('2026-10-31T04:00:00+01:00', 'b/job', 'retry', null, 'flaky'),
        '{bad',
      ].join('\n') + '\n',
    );
    const app = makeApp();
    const html = await (await app.request('/')).text();

    const li = (night: string) => {
      const m = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].find((x) => x[1].includes(night));
      expect(m, `board entry for ${night}`).toBeDefined();
      return m![1];
    };

    // Main night: 7 ok, 5 retry (2 + 3), 1 fail.
    const counts = (entry: string) => {
      const text = strip(entry);
      const n = (word: string) => {
        const m = text.match(new RegExp(`${word}\\D{0,3}(\\d+)|(\\d+)\\s*${word}`, 'i'));
        return m ? Number(m[1] ?? m[2]) : null;
      };
      return { ok: n('ok'), retry: n('retry'), fail: n('fail') };
    };

    expect(li(NIGHT)).toContain(`href="/digest/${NIGHT}"`);
    expect(counts(li(NIGHT))).toEqual({ ok: 7, retry: 5, fail: 1 });
    expect(li(second)).toContain(`href="/digest/${second}"`);
    expect(counts(li(second))).toEqual({ ok: 2, retry: 1, fail: 1 });

    for (const night of [NIGHT, second]) {
      expect((await app.request(`/digest/${night}`)).status).toBe(200);
    }
  });
});
