import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GATE_REQUIRED_FIELDS, GATE_CONDITIONAL_FIELDS } from '../src/gate.js';

// The gate decides in code what the database also decides in its CHECK
// constraint. Two rules that must agree, with nothing checking them, is how
// both hand-found bugs happened. This test reads the database's own rule out
// of the migration and fails the moment the two lists diverge, in either
// direction: a column added to the constraint, or a field dropped from the gate.

const MIGRATION = 'migrations/20260915000100_core_schema.sql';

function sourcesColumns(sql) {
  const table = sql.slice(sql.indexOf('CREATE TABLE sources ('));
  const body = table.slice(0, table.indexOf('\n);'));
  const names = new Set();
  for (const line of body.split('\n').slice(1)) {
    const m = line.match(/^\s{2}([a-z_0-9]+)\s+(TEXT|INTEGER|REAL)/);
    if (m) names.add(m[1]);
  }
  return names;
}

// The "active = 0 OR ( ... )" clause: everything a row needs before it may be crawled.
function activeCheckClause(sql) {
  const start = sql.indexOf('active = 0 OR (');
  assert.ok(start > 0, 'the sources CHECK clause moved; this test must be updated with it');
  let depth = 0;
  for (let i = sql.indexOf('(', start); i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced parentheses in the sources CHECK clause');
}

test('the gate and the database require exactly the same fields', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const columns = sourcesColumns(sql);
  const clause = activeCheckClause(sql);

  const required = new Set();
  for (const word of clause.match(/[a-z_0-9]+/g) ?? []) {
    if (columns.has(word) && word !== 'active') required.add(word);
  }

  const gate = new Set([...GATE_REQUIRED_FIELDS, ...GATE_CONDITIONAL_FIELDS]);
  const missingFromGate = [...required].filter((f) => !gate.has(f)).sort();
  const extraInGate = [...gate].filter((f) => !required.has(f)).sort();

  assert.deepEqual(missingFromGate, [],
    `the database requires these before crawling, and the gate does not check them: ${missingFromGate.join(', ')}`);
  assert.deepEqual(extraInGate, [],
    `the gate checks fields the database does not require; one of the two is wrong: ${extraInGate.join(', ')}`);
  assert.ok(required.size >= 15, `expected at least 15 required fields, found ${required.size}`);
});

test('the drift test can actually fail (it is not a rubber stamp)', () => {
  // Same comparison, with one field removed from the gate's list: it must fail.
  const sql = readFileSync(MIGRATION, 'utf8');
  const columns = sourcesColumns(sql);
  const clause = activeCheckClause(sql);
  const required = new Set();
  for (const word of clause.match(/[a-z_0-9]+/g) ?? []) {
    if (columns.has(word) && word !== 'active') required.add(word);
  }
  const crippled = new Set([...GATE_REQUIRED_FIELDS, ...GATE_CONDITIONAL_FIELDS].filter((f) => f !== 'robots_sha256'));
  const missing = [...required].filter((f) => !crippled.has(f));
  assert.deepEqual(missing, ['robots_sha256'], 'a dropped gate field must be detected');
});
