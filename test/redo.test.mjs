import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rules, decision, command} from '../core.mjs';

const fixture = JSON.parse(readFileSync(new URL('vscode.json', import.meta.url)));
const [sessions, terminal] = rules(JSON.stringify([
  { id: 'sessions', label: 'Inspect session icons', paths: ['src/vs/workbench/contrib/sessions/**'] },
  { id: 'terminal', label: 'Open a terminal', paths: ['src/vs/workbench/contrib/terminal/**'] }
]));
const compare = fixture;
test('Microsoft VS Code PR replay with simulated prior sign-offs', () => {
  assert.deepEqual(decision(sessions, fixture.base, fixture.head, compare), ['Redo', fixture.files[1].filename]);
  assert.equal(decision(terminal, fixture.base, fixture.head, compare)[0], 'Passed');
});
test('first check and fresh approval', () => {
  assert.equal(decision(sessions, null, fixture.head)[0], 'Open');
  assert.equal(decision(sessions, fixture.head, fixture.head)[0], 'Passed');
});
test('rename out of a watched directory reopens check', () => {
  assert.equal(decision(sessions, 'older','new',{status:'ahead',files:[{previous_filename:fixture.files[1].filename,filename:'other.ts'}]})[0],'Redo');
});
test('incomplete comparisons and rewritten history reopen checks', () => {
  for (const comparison of [null,{status:'diverged',files:[]},{status:'ahead',files:Array(300).fill({filename:'README.md'})}])
    assert.equal(decision(sessions,'older','new',comparison)[0],'Redo');
});
test('commands bind a single rule version and full commit', () => {
  const line = '/redo pass sessions ' + fixture.head + ' ' + sessions.key;
  assert.ok(command(line));
  assert.equal(command('> ' + line),null);
  assert.equal(command(line + '\n' + line),null);
  assert.throws(()=>rules(JSON.stringify([sessions,sessions])));
});
