import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../src/solver.js';
import { validateProblem, baselineAssignments } from '../src/model.js';
import { verifyAssignments } from '../src/verify.js';
import { DEMOS } from '../src/demos.js';
import { exhaustiveOracle, referenceObjective, referenceFeasible, compareObjectives, makeProblem, makeSeededProblem } from './oracle.js';

function checked(problem) {
  const parsed = validateProblem(problem);
  assert.equal(parsed.ok, true, parsed.errors?.join('\n'));
  return parsed.value;
}
function checkResult(problem, actual, expected = null) {
  assert.ok(['optimal', 'feasible', 'infeasible', 'unknown'].includes(actual.status));
  assert.ok(['complete', 'budget', 'cancelled'].includes(actual.reason));
  assert.ok(Number.isInteger(actual.nodes) && actual.nodes >= 0);
  assert.ok(Array.isArray(actual.diagnostics));
  if (actual.assignments !== null) {
    assert.equal(referenceFeasible(problem, actual.assignments), true, 'Independent oracle must accept the witness');
    const verified = verifyAssignments(problem, actual.assignments);
    assert.equal(verified.ok, true, verified.errors?.join('\n'));
    assert.deepEqual(actual.objective, referenceObjective(problem, actual.assignments));
    assert.ok(['optimal', 'feasible'].includes(actual.status));
  } else {
    assert.equal(actual.objective, null);
    assert.ok(['infeasible', 'unknown'].includes(actual.status));
  }
  if (actual.reason === 'complete') assert.ok(['optimal', 'infeasible'].includes(actual.status));
  else assert.ok(['feasible', 'unknown'].includes(actual.status));
  if (expected !== null) {
    assert.equal(actual.reason, 'complete');
    assert.equal(actual.status, expected.assignments === null ? 'infeasible' : 'optimal');
    assert.deepEqual(actual.objective, expected.objective, 'All objective components, including tieBreak, must match exhaustive enumeration');
  }
}

let randomFeasible = 0;
let randomInfeasible = 0;
for (let seed = 1; seed <= 150; seed++) {
  test(`exhaustive differential seed ${seed}`, async () => {
    const problem = checked(makeSeededProblem(seed));
    const expected = exhaustiveOracle(problem);
    if (expected.assignments === null) randomInfeasible++;
    else randomFeasible++;
    const actual = await solve(problem, { nodeBudget: 200000, yieldEvery: 128 });
    checkResult(problem, actual, expected);
  });
}
test('seed bank exercises both feasible and infeasible cases', () => {
  assert.ok(randomFeasible >= 20, `Only ${randomFeasible} feasible seeds`);
  assert.ok(randomInfeasible >= 20, `Only ${randomInfeasible} infeasible seeds`);
});

const displacement = () => makeProblem([
  { id: 'affected', start: 540, earliestStart: 540, latestStart: 570, eligibleRoomIds: ['A'] },
  { id: 'unaffected', start: 570, earliestStart: 570, latestStart: 600, eligibleRoomIds: ['A'] },
], {
  day: { start: 540, end: 660, step: 30 },
  blackouts: [{ id: 'closure', type: 'room', targetId: 'A', start: 540, end: 570 }],
});

test('a blocked session can displace a previously unaffected session', async () => {
  const problem = checked(displacement());
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.deepEqual(result.objective, { changedSessions: 2, totalShiftMinutes: 60, roomChanges: 0, tieBreak: [570, 0, 600, 0] });
});

test('first minimize changed-session count rather than locally fixing the earliest slot', async () => {
  const problem = displacement();
  problem.sessions[0].latestStart = 630;
  checked(problem);
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.objective.changedSessions, 1);
  assert.equal(result.assignments.find(item => item.id === 'affected').start, 600);
  assert.equal(result.assignments.find(item => item.id === 'unaffected').start, 570);
});

test('time-shift cost outranks room changes', async () => {
  const problem = checked(makeProblem([{ start: 540, latestStart: 570 }], {
    blackouts: [{ id: 'closure', type: 'room', targetId: 'A', start: 540, end: 570 }],
  }));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.objective.totalShiftMinutes, 0);
  assert.equal(result.objective.roomChanges, 1);
});

test('equal shift costs favor fewer room changes', async () => {
  const problem = checked(makeProblem([{ start: 570, earliestStart: 540, latestStart: 600 }], {
    blackouts: [
      { id: 'first', type: 'room', targetId: 'A', start: 570, end: 600 },
      { id: 'second', type: 'room', targetId: 'B', start: 570, end: 600 },
    ],
  }));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.objective.roomChanges, 0);
  assert.equal(result.assignments[0].start, 540);
});

test('tie-break uses ASCII IDs and numeric start/room rank, not input order', async () => {
  const problem = checked(makeProblem([
    { id: 'a', start: 540, earliestStart: 540, latestStart: 555, duration: 15, roomId: 'm', eligibleRoomIds: ['a', 'Z'] },
    { id: 'Z', start: 540, earliestStart: 540, latestStart: 555, duration: 15, roomId: 'm', eligibleRoomIds: ['a', 'Z'] },
  ], { rooms: [{ id: 'm', label: 'Original' }, { id: 'a', label: 'Lowercase' }, { id: 'Z', label: 'Uppercase' }] }));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.deepEqual(result.objective.tieBreak, [540, 0, 540, 1]);
});

test('shared equipment blocks simultaneous sessions in different rooms', async () => {
  const problem = checked(makeProblem([
    { start: 540, roomId: 'A', earliestStart: 540, latestStart: 570, resourceIds: ['projector'] },
    { start: 540, roomId: 'B', earliestStart: 540, latestStart: 570, resourceIds: ['projector'] },
  ]));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.objective.changedSessions, 1);
  assert.equal(result.objective.totalShiftMinutes, 30);
});

test('room conflicts apply even without shared resources', async () => {
  const problem = checked(makeProblem([
    { start: 540, earliestStart: 540, latestStart: 540 },
    { start: 540, earliestStart: 540, latestStart: 540 },
  ]));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.objective.changedSessions, 1);
  assert.equal(new Set(result.assignments.map(item => item.roomId)).size, 2);
});

test('half-open boundaries permit room/resource touching and blackout touching', async () => {
  const problem = checked(makeProblem([
    { start: 540, earliestStart: 540, latestStart: 540, eligibleRoomIds: ['A'], resourceIds: ['projector'] },
    { start: 570, earliestStart: 570, latestStart: 570, eligibleRoomIds: ['A'], resourceIds: ['projector'] },
  ], { blackouts: [
    { id: 'room', type: 'room', targetId: 'A', start: 600, end: 615 },
    { id: 'equipment', type: 'resource', targetId: 'projector', start: 600, end: 620 },
  ] }));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.objective.changedSessions, 0);
});

test('non-grid duration and non-grid blackout endpoint are enforced exactly', async () => {
  const problem = checked(makeProblem([{ duration: 20, start: 540, earliestStart: 540, latestStart: 585, eligibleRoomIds: ['A'] }], {
    blackouts: [{ id: 'closure', type: 'room', targetId: 'A', start: 559, end: 571 }],
  }));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.assignments[0].start, 585);
});

test('pinned session overlapping a blackout is infeasible', async () => {
  const problem = checked(makeProblem([{ pinned: true, start: 540 }], {
    blackouts: [{ id: 'closure', type: 'room', targetId: 'A', start: 550, end: 560 }],
  }));
  checkResult(problem, await solve(problem), exhaustiveOracle(problem));
});

test('pins do not override room eligibility or repair windows', async () => {
  for (const patch of [{ eligibleRoomIds: ['B'] }, { earliestStart: 555 }]) {
    const problem = checked(makeProblem([{ pinned: true, start: 540, ...patch }]));
    checkResult(problem, await solve(problem), exhaustiveOracle(problem));
  }
});

test('two pinned sessions sharing equipment are infeasible', async () => {
  const problem = checked(makeProblem([
    { start: 540, roomId: 'A', resourceIds: ['projector'], pinned: true },
    { start: 540, roomId: 'B', resourceIds: ['projector'], pinned: true },
  ]));
  checkResult(problem, await solve(problem), exhaustiveOracle(problem));
});

test('legal baseline requires zero changes', async () => {
  const problem = checked(makeProblem([{}, {}]));
  const before = structuredClone(problem);
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.objective.changedSessions, 0);
  assert.equal(result.objective.totalShiftMinutes, 0);
  assert.equal(result.objective.roomChanges, 0);
  assert.deepEqual(problem, before, 'Solving must not mutate input');
});

test('ineligible baseline room is repaired instead of silently retained', async () => {
  const problem = checked(makeProblem([{ eligibleRoomIds: ['B'], earliestStart: 540, latestStart: 540 }]));
  const result = await solve(problem);
  checkResult(problem, result, exhaustiveOracle(problem));
  assert.equal(result.assignments[0].roomId, 'B');
});

test('result is invariant to ordering of all input collections', async () => {
  for (const seed of [4, 8, 12, 17, 23, 35, 67, 99, 126, 141]) {
    const problem = checked(makeSeededProblem(seed));
    const reversed = structuredClone(problem);
    reversed.sessions.reverse(); reversed.rooms.reverse(); reversed.resources.reverse(); reversed.blackouts.reverse();
    for (const session of reversed.sessions) { session.eligibleRoomIds.reverse(); session.resourceIds.reverse(); }
    const first = await solve(problem);
    const second = await solve(reversed);
    checkResult(problem, first, exhaustiveOracle(problem));
    checkResult(reversed, second, exhaustiveOracle(reversed));
    assert.equal(first.status, second.status);
    assert.deepEqual(first.objective, second.objective);
  }
});

test('increasing deterministic node budgets preserves or improves incumbents', async () => {
  const problem = checked(DEMOS[1].problem);
  let incumbent = null;
  for (const nodeBudget of [1, 2, 8, 64, 512, 200000]) {
    const result = await solve(problem, { nodeBudget, yieldEvery: 32 });
    checkResult(problem, result);
    assert.ok(result.nodes <= nodeBudget, `Visited ${result.nodes} nodes for budget ${nodeBudget}`);
    if (incumbent !== null) {
      assert.notEqual(result.objective, null, 'A larger budget lost an earlier incumbent');
      assert.ok(compareObjectives(result.objective, incumbent) <= 0, 'A larger budget worsened the incumbent');
    }
    if (result.objective !== null) incumbent = result.objective;
  }
  assert.notEqual(incumbent, null);
});

test('identical budgeted runs are deterministic', async () => {
  const problem = checked(DEMOS[1].problem);
  const first = await solve(problem, { nodeBudget: 32, yieldEvery: 8 });
  const second = await solve(problem, { nodeBudget: 32, yieldEvery: 64 });
  assert.deepEqual(first, second);
  checkResult(problem, first);
});

test('immediate cancellation never claims completion', async () => {
  const problem = checked(displacement());
  const result = await solve(problem, { shouldCancel: () => true, yieldEvery: 1 });
  checkResult(problem, result);
  assert.equal(result.reason, 'cancelled');
  assert.ok(['unknown', 'feasible'].includes(result.status));
});

test('cancellation after progress retains only a verified incumbent', async () => {
  const problem = checked(DEMOS[1].problem);
  let cancel = false;
  const updates = [];
  const result = await solve(problem, {
    nodeBudget: 200000, yieldEvery: 1,
    shouldCancel: () => cancel,
    onProgress: progress => { updates.push(progress); if (progress.objective !== null) cancel = true; },
  });
  checkResult(problem, result);
  assert.ok(updates.length > 0);
  assert.equal(result.reason, 'cancelled');
  assert.equal(result.status, 'feasible');
  assert.notEqual(result.objective, null, 'Cancellation must retain the incumbent');
  assert.deepEqual(result.objective, updates.at(-1).objective);
  for (let index = 1; index < updates.length; index++) assert.ok(updates[index].nodes >= updates[index - 1].nodes);
});

test('production verifier independently rejects corrupted witnesses', () => {
  const problem = checked(makeProblem([
    { earliestStart: 540, latestStart: 600, eligibleRoomIds: ['A'], resourceIds: ['projector'], pinned: true },
    { earliestStart: 540, latestStart: 600, eligibleRoomIds: ['B'], roomId: 'B', resourceIds: ['projector'] },
  ]));
  const valid = baselineAssignments(problem);
  assert.equal(verifyAssignments(problem, valid).ok, true);
  const alterations = [
    list => list.pop(),
    list => list.push({ ...list[0] }),
    list => { list[0].id = 'missing'; },
    list => { list[0].start = 541; },
    list => { list[0].start = 555; },
    list => { list[0].roomId = 'B'; },
    list => { list[1].start = 660; },
    list => { list[1].start = 540; },
    list => { list[1].roomId = 'missing'; },
  ];
  for (const alter of alterations) {
    const broken = structuredClone(valid); alter(broken);
    const result = verifyAssignments(problem, broken);
    assert.equal(result.ok, false, JSON.stringify(broken));
    assert.ok(result.errors.length > 0);
  }
});

test('solver refuses malformed input', async () => {
  const bad = makeProblem([{}]); bad.sessions[0].duration = -1;
  await assert.rejects(() => solve(bad));
});

for (const demo of DEMOS) {
  test(`synthetic demo ${demo.id} validates and has expected outcome`, async () => {
    const problem = checked(demo.problem);
    const result = await solve(problem, { nodeBudget: 200000 });
    checkResult(problem, result);
    assert.equal(result.status, demo.id === 'pinned-obstruction' ? 'infeasible' : 'optimal');
    if (demo.id !== 'pinned-obstruction') assert.ok(result.objective.changedSessions > 0);
  });
}


test('zero budget distinguishes a proved baseline from an unexplored repair', async () => {
  const legal = checked(makeProblem([{}]));
  const proven = await solve(legal, { nodeBudget: 0 });
  checkResult(legal, proven);
  assert.equal(proven.status, 'optimal');
  assert.equal(proven.nodes, 0);
  const repair = checked(displacement());
  const interrupted = await solve(repair, { nodeBudget: 0 });
  checkResult(repair, interrupted);
  assert.equal(interrupted.status, 'unknown');
  assert.equal(interrupted.reason, 'budget');
  assert.equal(interrupted.assignments, null);
});

test('a budget one node short cannot be mistaken for proof of infeasibility', async () => {
  const problem = checked(makeProblem([{ earliestStart: 540, latestStart: 540, eligibleRoomIds: ['B'] }]));
  const short = await solve(problem, { nodeBudget: 1 });
  const enough = await solve(problem, { nodeBudget: 2 });
  checkResult(problem, short);
  checkResult(problem, enough, exhaustiveOracle(problem));
  assert.equal(short.status, 'unknown');
  assert.equal(short.reason, 'budget');
  assert.equal(enough.status, 'optimal');
  assert.equal(enough.nodes, 2);
});

test('independent verifier rejects room and equipment blackout witnesses', () => {
  for (const type of ['room', 'resource']) {
    const problem = checked(makeProblem([{ resourceIds: ['projector'] }], {
      blackouts: [{ id: 'blocked', type, targetId: type === 'room' ? 'A' : 'projector', start: 559, end: 560 }],
    }));
    const baseline = baselineAssignments(problem);
    assert.equal(referenceFeasible(problem, baseline), false);
    const result = verifyAssignments(problem, baseline);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  }
});

test('resource and blackout input reordering preserves a budgeted search prefix', async () => {
  const problem = checked(DEMOS[1].problem);
  const reordered = structuredClone(problem);
  reordered.rooms.reverse(); reordered.resources.reverse(); reordered.sessions.reverse(); reordered.blackouts.reverse();
  for (const session of reordered.sessions) { session.eligibleRoomIds.reverse(); session.resourceIds.reverse(); }
  const a = await solve(problem, { nodeBudget: 8, yieldEvery: 2 });
  const b = await solve(reordered, { nodeBudget: 8, yieldEvery: 7 });
  assert.deepEqual(a, b);
});

test('extended batched exhaustive differential bank: 2,000 additional deterministic inputs', async () => {
  let feasible = 0;
  let infeasible = 0;
  let leaves = 0;
  for (let seed = 150001; seed <= 152000; seed++) {
    const problem = checked(makeSeededProblem(seed));
    const expected = exhaustiveOracle(problem);
    const actual = await solve(problem, { nodeBudget: 200000, yieldEvery: 512 });
    try { checkResult(problem, actual, expected); }
    catch (error) { error.message = `Extended seed ${seed}: ${error.message}`; throw error; }
    if (expected.assignments === null) infeasible++;
    else feasible++;
    leaves += expected.leaves;
  }
  assert.equal(feasible, 801);
  assert.equal(infeasible, 1199);
  assert.equal(leaves, 81963);
});
