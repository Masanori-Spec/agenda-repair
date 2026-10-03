import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProblem, parseProblem, baselineAssignments, minuteLabel } from '../src/model.js';
import { DEMOS } from '../src/demos.js';
import { makeProblem } from './oracle.js';

function rejected(input) {
  const result = validateProblem(input);
  assert.equal(result.ok, false, `Unexpectedly accepted ${JSON.stringify(input)}`);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
}
function mutated(change) { const problem = makeProblem([{}]); change(problem); rejected(problem); }

test('valid input is cloned deeply and preserves the original baseline', () => {
  const input = makeProblem([{}]);
  const result = validateProblem(input);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.deepEqual(result.value, input);
  assert.notEqual(result.value, input);
  result.value.sessions[0].eligibleRoomIds.push('other');
  result.value.rooms[0].label = 'Changed';
  assert.deepEqual(input.sessions[0].eligibleRoomIds, ['A', 'B']);
  assert.equal(input.rooms[0].label, 'Studio A');
  assert.deepEqual(baselineAssignments(input), [{ id: 's1', start: 540, roomId: 'A' }]);
});

test('parse accepts only the baseline problem schema, not a proposal envelope', () => {
  const problem = makeProblem([{}]);
  assert.equal(parseProblem(JSON.stringify(problem)).ok, true);
  for (const text of ['', '{', 'null', '[]', 'true', '42', '"agenda"', '{"version":1}', JSON.stringify({ version: 1, problem, proposal: {} })]) {
    const result = parseProblem(text);
    assert.equal(result.ok, false, text);
    assert.ok(result.errors.length > 0);
  }
});

test('imports larger than 100KB are rejected before use', () => {
  assert.equal(parseProblem(' '.repeat(100001)).ok, false);
  const large = makeProblem([{}]); large.title = 'a'.repeat(100001);
  assert.equal(parseProblem(JSON.stringify(large)).ok, false);
});

test('unknown keys are rejected at every object nesting level', () => {
  const changes = [
    problem => { problem.unknown = true; },
    problem => { problem.day.unknown = true; },
    problem => { problem.rooms[0].unknown = true; },
    problem => { problem.resources[0].unknown = true; },
    problem => { problem.sessions[0].unknown = true; },
    problem => { problem.blackouts = [{ id: 'x', type: 'room', targetId: 'A', start: 540, end: 550, unknown: true }]; },
  ];
  for (const change of changes) mutated(change);
});

test('JSON prototype keys cannot alter global prototypes or bypass schema checks', () => {
  const baseline = JSON.stringify(makeProblem([{}]));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const raw = baseline.replace('{', `{"${key}":{"polluted":true},`);
    assert.equal(parseProblem(raw).ok, false, key);
    const nested = baseline.replace('"day":{', `"day":{"${key}":{"polluted":true},`);
    assert.equal(parseProblem(nested).ok, false, `${key} nested`);
  }
  assert.equal({}.polluted, undefined);
});

test('malicious-looking labels remain inert plain text data', () => {
  const problem = makeProblem([{}]);
  problem.title = '<img src=x onerror=alert(1)>';
  problem.rooms[0].label = '<script>alert("test")</script>';
  problem.sessions[0].title = '</textarea><svg onload=alert(1)>';
  const result = parseProblem(JSON.stringify(problem));
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.value.title, problem.title);
  assert.equal(result.value.rooms[0].label, problem.rooms[0].label);
  assert.equal(result.value.sessions[0].title, problem.sessions[0].title);
});

test('invalid top-level shapes and missing keys are rejected', () => {
  for (const value of [null, undefined, [], 1, '', false]) rejected(value);
  for (const key of Object.keys(makeProblem([{}]))) {
    const problem = makeProblem([{}]); delete problem[key]; rejected(problem);
  }
});

test('schema never coerces strings, booleans, non-finite or fractional numbers', () => {
  const changes = [
    problem => { problem.version = '1'; },
    problem => { problem.day.start = '540'; },
    problem => { problem.day.step = 1.5; },
    problem => { problem.day.end = Infinity; },
    problem => { problem.sessions[0].start = NaN; },
    problem => { problem.sessions[0].duration = '30'; },
    problem => { problem.sessions[0].duration = 1.5; },
    problem => { problem.sessions[0].pinned = 0; },
    problem => { problem.sessions[0].title = 12; },
    problem => { problem.rooms[0].label = null; },
  ];
  for (const change of changes) mutated(change);
});

test('clock bounds, windows, grid alignment and duration are checked', () => {
  const changes = [
    problem => { problem.day.start = -1; },
    problem => { problem.day.end = 1441; },
    problem => { problem.day.end = problem.day.start; },
    problem => { problem.day.step = 0; },
    problem => { problem.day.step = 61; },
    problem => { problem.sessions[0].duration = 0; },
    problem => { problem.sessions[0].duration = 121; },
    problem => { problem.sessions[0].start = 541; },
    problem => { problem.sessions[0].earliestStart = 541; },
    problem => { problem.sessions[0].latestStart = 631; },
    problem => { problem.sessions[0].earliestStart = 645; },
    problem => { problem.sessions[0].latestStart = 645; },
    problem => { problem.sessions[0].earliestStart = 525; },
  ];
  for (const change of changes) mutated(change);
});

test('label bounds and controls are rejected without requiring ASCII prose', () => {
  for (const field of ['title']) {
    mutated(problem => { problem[field] = 'x'.repeat(121); });
    mutated(problem => { problem[field] = 'line\nbreak'; });
    mutated(problem => { problem[field] = 'null\u0000byte'; });
  }
  mutated(problem => { problem.rooms[0].label = 'x'.repeat(121); });
  mutated(problem => { problem.sessions[0].title = 'x'.repeat(121); });
  const problem = makeProblem([{}]); problem.title = '架空の制作会 • Café 🎨';
  assert.equal(validateProblem(problem).ok, true);
});

test('identifiers, duplicate references and unknown references are rejected', () => {
  const changes = [
    problem => { problem.sessions[0].id = '../x'; },
    problem => { problem.sessions[0].id = '__proto__'; },
    problem => { problem.rooms[0].id = 'x'.repeat(41); },
    problem => { problem.rooms[1].id = 'A'; },
    problem => { problem.sessions.push(structuredClone(problem.sessions[0])); },
    problem => { problem.sessions[0].roomId = 'missing'; },
    problem => { problem.sessions[0].eligibleRoomIds = []; },
    problem => { problem.sessions[0].eligibleRoomIds = ['missing']; },
    problem => { problem.sessions[0].eligibleRoomIds = ['A', 'A']; },
    problem => { problem.sessions[0].resourceIds = ['missing']; },
    problem => { problem.sessions[0].resourceIds = ['projector', 'projector']; },
  ];
  for (const change of changes) mutated(change);
});

test('collection and nominal domain limits prevent accidental runaway work', () => {
  mutated(problem => { problem.rooms = Array.from({ length: 7 }, (_, index) => ({ id: `r${index}`, label: 'Room' })); });
  mutated(problem => { problem.resources = Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, label: 'Equipment' })); });
  mutated(problem => { problem.sessions = Array.from({ length: 21 }, (_, index) => ({ ...problem.sessions[0], id: `s${index}`, pinned: true })); });
  mutated(problem => { problem.sessions = Array.from({ length: 9 }, (_, index) => ({ ...problem.sessions[0], id: `s${index}` })); });
  mutated(problem => { problem.blackouts = Array.from({ length: 25 }, (_, index) => ({ id: `b${index}`, type: 'room', targetId: 'A', start: 540, end: 541 })); });
  mutated(problem => {
    problem.day = { start: 0, end: 1440, step: 1 };
    Object.assign(problem.sessions[0], { start: 0, duration: 1, earliestStart: 0, latestStart: 120, eligibleRoomIds: ['A'] });
  });
  const boundary = makeProblem([{}]);
  boundary.day = { start: 0, end: 1440, step: 1 };
  Object.assign(boundary.sessions[0], { start: 0, duration: 1, earliestStart: 0, latestStart: 119, eligibleRoomIds: ['A'] });
  assert.equal(validateProblem(boundary).ok, true, '120 candidates should be allowed');
});

test('blackout type, references, bounds, duplicate IDs and strict fields are checked', () => {
  const base = { id: 'closure', type: 'room', targetId: 'A', start: 545, end: 552 };
  for (const patch of [{ type: 'person' }, { targetId: 'missing' }, { start: 539 }, { end: 661 }, { end: 545 }, { start: 550, end: 549 }, { start: 545.5 }]) {
    mutated(problem => { problem.blackouts = [{ ...base, ...patch }]; });
  }
  mutated(problem => { problem.blackouts = [{ ...base }, { ...base }]; });
  const problem = makeProblem([{}], { blackouts: [{ ...base }] });
  assert.equal(validateProblem(problem).ok, true, 'Blackouts need not be grid aligned');
});

test('all synthetic demo problem objects round-trip through strict JSON parsing', () => {
  assert.equal(DEMOS.length, 3);
  assert.equal(new Set(DEMOS.map(demo => demo.id)).size, 3);
  for (const demo of DEMOS) {
    const parsed = parseProblem(JSON.stringify(demo.problem));
    assert.equal(parsed.ok, true, `${demo.id}: ${parsed.errors?.join('\n')}`);
    const normalized = structuredClone(demo.problem);
    const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    for (const field of ['rooms', 'resources', 'sessions', 'blackouts']) normalized[field].sort(byId);
    for (const session of normalized.sessions) { session.eligibleRoomIds.sort(); session.resourceIds.sort(); }
    assert.deepEqual(parsed.value, normalized);
    assert.deepEqual(parseProblem(JSON.stringify(parsed.value)).value, parsed.value);
    assert.ok(demo.problem.sessions.length <= 20);
    assert.ok(demo.problem.sessions.filter(session => !session.pinned).length <= 8);
  }
});

test('minute labels represent the start and end of a full day', () => {
  assert.equal(minuteLabel(0), '00:00');
  assert.equal(minuteLabel(555), '09:15');
  assert.equal(minuteLabel(1440), '24:00');
});

test('C1 control characters are rejected consistently with C0 and DEL', () => {
  for (const codePoint of [0x7f, 0x80, 0x85, 0x9f]) {
    mutated(problem => { problem.title = `before${String.fromCharCode(codePoint)}after`; });
    mutated(problem => { problem.rooms[0].label = `before${String.fromCharCode(codePoint)}after`; });
  }
});

test('ordinary IDs that resemble JavaScript properties remain safe map keys', () => {
  const problem = makeProblem([{}]);
  problem.rooms[0].id = 'constructor';
  problem.sessions[0].id = 'toString';
  problem.sessions[0].roomId = 'constructor';
  problem.sessions[0].eligibleRoomIds = ['constructor', 'B'];
  assert.equal(validateProblem(problem).ok, true);
  assert.equal({}.polluted, undefined);
});
