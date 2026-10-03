import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { solve } from '../src/solver.js';
import { validateProblem } from '../src/model.js';
import { verifyAssignments } from '../src/verify.js';
import { DEMOS } from '../src/demos.js';
import { seededRandom, makeSeededProblem, exhaustiveOracle, referenceFeasible, referenceObjective } from '../tests/oracle.js';

/** Reproducible synthetic workload; not a claim about real customers' agendas. */
export function makeBenchmarkProblem(seed, size, roomCount, duration = 45) {
  const random = seededRandom(seed);
  const pick = max => Math.floor(random() * max);
  const rooms = Array.from({ length: roomCount }, (_, index) => ({ id: `r${index}`, label: `Synthetic room ${index + 1}` }));
  const sessions = Array.from({ length: size }, (_, index) => ({
    id: `s${String(index).padStart(2, '0')}`, title: `Synthetic benchmark session ${index + 1}`,
    duration, start: 540 + 15 * pick(7), roomId: rooms[pick(roomCount)].id,
    earliestStart: 540, latestStart: 900 - duration,
    eligibleRoomIds: rooms.map(room => room.id), resourceIds: [], pinned: false,
  }));
  return { version: 1, title: `Synthetic benchmark seed ${seed}`, day: { start: 540, end: 900, step: 15 }, rooms, resources: [], sessions, blackouts: [] };
}

export function makeMaximumDomainProblem() {
  const problem = makeBenchmarkProblem(120120, 8, 6, 30);
  problem.day.end = 855;
  problem.resources = [{ id: 'kit', label: 'One exclusive synthetic equipment kit' }];
  for (const session of problem.sessions) {
    session.latestStart = 825;
    session.resourceIds = ['kit'];
  }
  return problem;
}

export function makeFullCapacityProblem() {
  const problem = makeMaximumDomainProblem();
  problem.day.end = 915;
  for (let index = 0; index < 12; index++) {
    const start = 855 + 30 * Math.floor(index / 6);
    const roomId = `r${index % 6}`;
    problem.sessions.push({ id: `pin${String(index).padStart(2, '0')}`, title: `Synthetic pinned session ${index + 1}`, duration: 30, start, roomId, earliestStart: start, latestStart: start, eligibleRoomIds: [roomId], resourceIds: [], pinned: true });
  }
  return problem;
}

const variants = [
  ...DEMOS.map(demo => ({ id: demo.id, problem: demo.problem, budgets: [200000] })),
  { id: 'seeded-light-20261003', problem: makeBenchmarkProblem(20261003, 4, 2, 30), budgets: [256, 4096, 50000] },
  { id: 'seeded-medium-72817', problem: makeBenchmarkProblem(72817, 6, 2, 45), budgets: [256, 4096, 50000] },
  { id: 'seeded-tight-92389', problem: makeBenchmarkProblem(92389, 8, 1, 45), budgets: [256, 4096, 50000] },
  { id: 'seeded-max120-120120', problem: makeMaximumDomainProblem(), budgets: [200000] },
  { id: 'seeded-full20-120120', problem: makeFullCapacityProblem(), budgets: [200000] },
];
const results = [];
for (const variant of variants) {
  const parsed = validateProblem(variant.problem);
  if (!parsed.ok) throw new Error(`${variant.id}: ${parsed.errors.join('; ')}`);
  let nextWitnessStart = parsed.value.day.start;
  const knownWitness = variant.id.startsWith('seeded-') ? parsed.value.sessions.map(session => {
    if (session.pinned) return { id: session.id, start: session.start, roomId: session.roomId };
    const assigned = { id: session.id, start: nextWitnessStart, roomId: parsed.value.rooms[0].id };
    nextWitnessStart += session.duration;
    return assigned;
  }) : null;
  const knownFeasibleWitnessVerified = knownWitness === null ? null : referenceFeasible(parsed.value, knownWitness);
  if (knownWitness !== null && !knownFeasibleWitnessVerified) throw new Error(`${variant.id}: constructed witness is invalid`);
  for (const nodeBudget of variant.budgets) {
    const started = performance.now();
    const result = await solve(parsed.value, { nodeBudget, yieldEvery: 512 });
    const elapsedMs = performance.now() - started;
    let verified = null;
    if (result.assignments) {
      verified = verifyAssignments(parsed.value, result.assignments).ok && referenceFeasible(parsed.value, result.assignments);
      if (!verified) throw new Error(`${variant.id}: returned invalid assignments`);
      if (JSON.stringify(result.objective) !== JSON.stringify(referenceObjective(parsed.value, result.assignments))) throw new Error(`${variant.id}: incorrect objective`);
    }
    results.push({
      id: variant.id, nodeBudget, sessions: parsed.value.sessions.length, rooms: parsed.value.rooms.length,
      nominalDomains: parsed.value.sessions.filter(session => !session.pinned).map(session => (1 + (session.latestStart - session.earliestStart) / parsed.value.day.step) * session.eligibleRoomIds.length),
      status: result.status, reason: result.reason, nodes: result.nodes, objective: result.objective,
      verified, knownFeasibleWitnessVerified, elapsedMs: Number(elapsedMs.toFixed(3)),
    });
  }
}
let feasibleSeeds = 0;
let infeasibleSeeds = 0;
let exhaustiveLeaves = 0;
let maxLeaves = 0;
for (const seed of [...Array.from({ length: 150 }, (_, index) => index + 1), ...Array.from({ length: 2000 }, (_, index) => index + 150001)]) {
  const result = exhaustiveOracle(makeSeededProblem(seed));
  if (result.assignments) feasibleSeeds++;
  else infeasibleSeeds++;
  exhaustiveLeaves += result.leaves;
  maxLeaves = Math.max(maxLeaves, result.leaves);
}
const report = {
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), cpuModel: os.cpus()[0]?.model ?? 'unavailable' },
  method: 'Single local Node run per workload/budget; wall time includes cooperative timer yields. No browser timing, no production traffic, no statistical latency claim. Search control is a deterministic node budget.',
  differentialBank: { inputs: 2150, seedRanges: [[1, 150], [150001, 152000]], feasibleSeeds, infeasibleSeeds, exhaustiveLeaves, maxLeaves },
  results,
};
const serialized = JSON.stringify(report, null, 2);
writeFileSync(new URL('../docs/benchmark-results.json', import.meta.url), `${serialized}\n`);
console.log(serialized);
