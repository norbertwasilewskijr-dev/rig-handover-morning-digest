import type { DigestNight, DigestRow } from '../digest/types.js';

const dash = '—';

function warnings(row: DigestRow): string[] {
  const out: string[] = [];
  if (row.retries >= 3) out.push(`${row.retries} retries (3 or more)`);
  if (row.fails > 0) out.push(`${row.fails} ${row.fails === 1 ? 'fail' : 'fails'}`);
  return out;
}

export function DigestPage({ digest }: { digest: DigestNight }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      {digest.badLines > 0 && (
        <p class="warn">
          {digest.badLines} {digest.badLines === 1 ? 'line' : 'lines'} in the log could not be read and{' '}
          {digest.badLines === 1 ? 'was' : 'were'} skipped.
        </p>
      )}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>fails</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
              <th>attention</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => {
              const marks = warnings(row);
              return (
                <tr>
                  <td>{row.job}</td>
                  <td>{row.owner ?? dash}</td>
                  <td>{row.runs}</td>
                  <td class={row.retries >= 3 ? 'warn' : undefined}>{row.retries}</td>
                  <td class={row.fails > 0 ? 'warn' : undefined}>{row.fails}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? dash}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                  <td class={marks.length > 0 ? 'warn' : undefined}>{marks.length > 0 ? marks.join('; ') : dash}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
