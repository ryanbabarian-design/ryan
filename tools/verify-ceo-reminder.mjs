// Optional local SQL verification; requires @electric-sql/pglite@0.5.17.
// Usage: node tools/verify-ceo-reminder.mjs [absolute-path-to-pglite/dist/index.js]
// No production database connection or email request is made.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const moduleName = process.argv[2] || '@electric-sql/pglite';
const { PGlite } = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const python = process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
const builder = resolve(root, 'tests/sql/build_ceo_reminder_7d_test.py');

for (const baseline of [true, false]) {
  const sql = execFileSync(python, [builder, ...(baseline ? ['--baseline'] : [])], { encoding: 'utf8' });
  const db = new PGlite();
  try {
    const results = await db.exec(sql);
    assert(!baseline, 'The original scheduler unexpectedly met the new seven-day policy');
    const summary = results.flatMap(result => result.rows || []).find(row => Number(row.passed) === 31);
    assert(summary, 'Expected all 31 SQL behavior assertions to pass');
    console.log(`GREEN: ${summary.passed} SQL behavior assertions passed`);
  } catch (error) {
    if (baseline && error.message.includes('FAIL: CEO receives no reminder before 168 hours')) {
      console.log('RED: original scheduler reproduced the early individual reminder');
    } else {
      throw error;
    }
  } finally {
    await db.close();
  }
}
