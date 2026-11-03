import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, ReadNight, RunStatus } from './types.js';

type RunRecord = {
  at: string;
  job: string;
  owner: string | null;
  status: RunStatus;
  error?: string;
};

const NIGHT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** True only for a real calendar date written as `YYYY-MM-DD`. */
export function isNight(night: string): boolean {
  const m = NIGHT.exec(night);
  return m !== null && isCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isTimestamp(value: string): boolean {
  const m = TIMESTAMP.exec(value);
  if (m === null) return false;
  const [, y, mo, d, h, mi, s, oh, om] = m;
  if (!isCalendarDate(Number(y), Number(mo), Number(d))) return false;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;
  if (oh !== undefined && (Number(oh) > 23 || Number(om) > 59)) return false;
  return true;
}

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function toRecord(value: unknown): RunRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== 'string' || !isTimestamp(v.at)) return null;
  if (typeof v.job !== 'string' || v.job.length === 0) return null;
  if (v.owner !== null && typeof v.owner !== 'string') return null;
  if (!isStatus(v.status)) return null;
  if ('error' in v && typeof v.error !== 'string') return null;
  const record: RunRecord = { at: v.at, job: v.job, owner: v.owner, status: v.status };
  if (typeof v.error === 'string') record.error = v.error;
  return record;
}

function isMissingFile(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

function toLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) throw new Error(`invalid night: ${JSON.stringify(night)}`);

  const text = readText(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const byJob = new Map<string, DigestRow>();
  let badLines = 0;

  for (const line of toLines(text)) {
    const record = toRecord(parseJson(line));
    if (record === null) {
      badLines++;
      continue;
    }
    const row = byJob.get(record.job);
    if (row === undefined) {
      byJob.set(record.job, {
        job: record.job,
        owner: record.owner,
        runs: 1,
        retries: record.status === 'retry' ? 1 : 0,
        fails: record.status === 'fail' ? 1 : 0,
        lastStatus: record.status,
        lastError: record.error ?? null,
        firstAt: record.at,
        lastAt: record.at,
      });
      continue;
    }
    row.owner = record.owner;
    row.runs++;
    if (record.status === 'retry') row.retries++;
    if (record.status === 'fail') row.fails++;
    row.lastStatus = record.status;
    if (record.error !== undefined) row.lastError = record.error;
    row.lastAt = record.at;
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  const result: DigestNight = { night, rows, badLines };
  return result;
};
