/** Status of one run-log record. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job's summary for a night, built from every valid record for that job. */
export type DigestRow = {
  job: string;
  /** `null` when the log says so; the row is kept and rendered as `—`. */
  owner: string | null;
  /** Every valid record for this job. */
  runs: number;
  /** Records with status `retry`. */
  retries: number;
  /** Records with status `fail`, counted even if the job later recovered. */
  fails: number;
  /** Status of the most recently recorded entry. */
  lastStatus: RunStatus;
  /** Error of the most recently recorded entry; `null` when that entry has none. */
  lastError: string | null;
  /** `at` of the earliest record, as in the log (offset preserved, never converted to UTC). */
  firstAt: string;
  /** `at` of the latest record, as in the log (offset preserved, never converted to UTC). */
  lastAt: string;
};

/** One night's digest: the shared result for the page, JSON, board and tests. */
export type DigestNight = {
  /** Night key, e.g. `2026-10-28` for `runs/2026-10-28.jsonl`. */
  night: string;
  /** One row per job, sorted by `job`. Empty when the file is empty. */
  rows: DigestRow[];
  /** Lines that didn't parse as a valid record; counted, never thrown. */
  badLines: number;
};

/**
 * Reads `<runsDir>/<night>.jsonl`.
 * Returns `null` only when the file does not exist; an empty or all-invalid file
 * yields a `DigestNight` with no rows.
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
