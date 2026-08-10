import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Guard against mojibake — UTF-8 bytes that were read back as Windows-1252 and
// re-saved, turning "A def. B · 7–5" into "A def. B Â· 7â€“5". Every confirmed
// match used to write a headline like that straight into the activity feed on
// the home page, and the push notification title was garbled too. It is
// invisible in a code review and only shows up in front of players.

const sourceFiles = execFileSync(
  'git',
  ['ls-files', '*.ts', '*.tsx', '*.mjs', '*.sql', '*.json', '*.md', '*.html', '*.css'],
  { encoding: 'utf8' },
)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

test('the repo has source files to check', () => {
  assert.ok(sourceFiles.length > 20, `expected a populated file list, got ${sourceFiles.length}`);
});

test('no source file contains mojibake', () => {
  // The leading byte of a UTF-8 sequence, misread as Windows-1252:
  //   C2 -> Â   (precedes ·, °, », non-breaking space…)
  //   E2 -> â   (precedes – — ‘ ’ “ ” …)
  //   F0 -> ð   (precedes every emoji)
  // A real word would not place these before the cp1252 continuation range.
  const pattern = /[Ââð][-ÿŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/;

  const offenders = [];
  for (const file of sourceFiles) {
    // This file necessarily contains mojibake — it is the thing being matched.
    if (file.endsWith('test/text-encoding.test.mjs')) continue;
    const text = readFileSync(file, 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      if (pattern.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `mis-encoded text — re-save as UTF-8:\n${offenders.join('\n')}`,
  );
});

test('no source file carries a byte-order mark', () => {
  // A BOM is how the round-trip that produces mojibake usually starts, and Deno
  // and some SQL tooling choke on it.
  const offenders = sourceFiles.filter(
    (file) => readFileSync(file, 'utf8').charCodeAt(0) === 0xFEFF,
  );
  assert.deepEqual(offenders, [], `strip the BOM from:\n${offenders.join('\n')}`);
});
