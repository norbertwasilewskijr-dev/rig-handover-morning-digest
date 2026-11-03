import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/readNight.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightEntry[];
};

// counts is null when the file vanished between listing and reading.
export type NightEntry = {
  night: string;
  counts: { ok: number; retry: number; fail: number; badLines: number } | null;
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export function nightEntry(runsDir: string, night: string): NightEntry {
  const digest = readNight(runsDir, night);
  if (!digest) return { night, counts: null };
  let ok = 0;
  let retry = 0;
  let fail = 0;
  for (const row of digest.rows) {
    ok += row.runs - row.retries - row.fails;
    retry += row.retries;
    fail += row.fails;
  }
  return { night, counts: { ok, retry, fail, badLines: digest.badLines } };
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((n) => nightEntry(config.runsDir, n)),
  };
}
