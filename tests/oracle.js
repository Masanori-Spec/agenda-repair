/**
 * Deliberately small, exhaustive reference implementation for TESTS ONLY.
 * It imports no production solver, model, verifier, or scoring functions.
 * Every leaf in the nominal Cartesian product is checked from scratch.
 */
export function referenceObjective(problem, assignments) {
  const ordered = [...problem.sessions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rooms = problem.rooms.map(room => room.id).sort();
  let changedSessions = 0;
  let totalShiftMinutes = 0;
  let roomChanges = 0;
  const tieBreak = [];
  for (const session of ordered) {
    const assigned = assignments.find(item => item.id === session.id);
    if (!assigned) throw new Error(`Missing assignment ${session.id}`);
    if (session.start !== assigned.start || session.roomId !== assigned.roomId) changedSessions++;
    totalShiftMinutes += Math.abs(session.start - assigned.start);
    if (session.roomId !== assigned.roomId) roomChanges++;
    tieBreak.push(assigned.start, rooms.indexOf(assigned.roomId));
  }
  return { changedSessions, totalShiftMinutes, roomChanges, tieBreak };
}

export function compareObjectives(a, b) {
  const first = [a.changedSessions, a.totalShiftMinutes, a.roomChanges, ...a.tieBreak];
  const second = [b.changedSessions, b.totalShiftMinutes, b.roomChanges, ...b.tieBreak];
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) return first[i] < second[i] ? -1 : 1;
  }
  return 0;
}

export function referenceFeasible(problem, assignments) {
  if (!Array.isArray(assignments) || assignments.length !== problem.sessions.length) return false;
  const seen = new Set();
  const placed = [];
  for (const assigned of assignments) {
    const session = problem.sessions.find(item => item.id === assigned.id);
    if (!session || seen.has(assigned.id)) return false;
    seen.add(assigned.id);
    if (!Number.isInteger(assigned.start)) return false;
    if (!problem.rooms.some(room => room.id === assigned.roomId)) return false;
    if ((assigned.start - problem.day.start) % problem.day.step !== 0) return false;
    if (assigned.start < problem.day.start || assigned.start + session.duration > problem.day.end) return false;
    if (assigned.start < session.earliestStart || assigned.start > session.latestStart) return false;
    if (!session.eligibleRoomIds.includes(assigned.roomId)) return false;
    if (session.pinned && (assigned.start !== session.start || assigned.roomId !== session.roomId)) return false;
    const finish = assigned.start + session.duration;
    for (const blackout of problem.blackouts) {
      const affected = blackout.type === 'room'
        ? assigned.roomId === blackout.targetId
        : session.resourceIds.includes(blackout.targetId);
      if (affected && assigned.start < blackout.end && blackout.start < finish) return false;
    }
    placed.push({ session, start: assigned.start, finish, roomId: assigned.roomId });
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!(a.start < b.finish && b.start < a.finish)) continue;
      if (a.roomId === b.roomId) return false;
      if (a.session.resourceIds.some(resource => b.session.resourceIds.includes(resource))) return false;
    }
  }
  return true;
}

export function exhaustiveOracle(problem) {
  const chosen = [];
  let assignments = null;
  let objective = null;
  let leaves = 0;
  function enumerate(index) {
    if (index === problem.sessions.length) {
      leaves++;
      if (!referenceFeasible(problem, chosen)) return;
      const candidate = referenceObjective(problem, chosen);
      if (objective === null || compareObjectives(candidate, objective) < 0) {
        objective = candidate;
        assignments = chosen.map(item => ({ ...item }));
      }
      return;
    }
    const session = problem.sessions[index];
    if (session.pinned) {
      chosen.push({ id: session.id, start: session.start, roomId: session.roomId });
      enumerate(index + 1);
      chosen.pop();
      return;
    }
    for (let time = session.earliestStart; time <= session.latestStart; time += problem.day.step) {
      for (const roomId of session.eligibleRoomIds) {
        chosen.push({ id: session.id, start: time, roomId });
        enumerate(index + 1);
        chosen.pop();
      }
    }
  }
  enumerate(0);
  return { assignments, objective, leaves };
}

export function makeProblem(sessions, overrides = {}) {
  return {
    version: 1,
    title: 'Synthetic test agenda',
    day: { start: 540, end: 660, step: 15 },
    rooms: [{ id: 'A', label: 'Studio A' }, { id: 'B', label: 'Studio B' }],
    resources: [{ id: 'projector', label: 'Shared projector' }],
    sessions: sessions.map((session, index) => ({
      id: `s${index + 1}`, title: `Synthetic session ${index + 1}`,
      duration: 30, start: 540 + index * 30, roomId: 'A',
      earliestStart: 540, latestStart: 630,
      eligibleRoomIds: ['A', 'B'], resourceIds: [], pinned: false,
      ...session,
    })),
    blackouts: [],
    ...overrides,
  };
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nominal domains are <=6, with at most four sessions: <=1296 leaves. */
export function makeSeededProblem(seed) {
  const random = seededRandom(seed);
  const integer = max => Math.floor(random() * max);
  const roomCount = 1 + integer(2);
  const rooms = ['a', 'Z'].slice(0, roomCount).map(id => ({ id, label: `Room ${id}` }));
  const resources = [{ id: 'camera', label: 'Camera' }, { id: 'mixer', label: 'Mixer' }];
  const count = 2 + integer(3);
  const sessions = Array.from({ length: count }, (_, index) => {
    const duration = [15, 20, 30][integer(3)];
    const earliestStart = 540 + 15 * integer(3);
    const latestStart = earliestStart + 15 * (1 + integer(2));
    const eligibleRoomIds = rooms.filter(() => random() > 0.25).map(room => room.id);
    if (!eligibleRoomIds.length) eligibleRoomIds.push(rooms[integer(rooms.length)].id);
    return {
      id: ['s9', 'A', 'a', 's10'][index], title: `Seed ${seed}, session ${index + 1}`,
      duration, start: 540 + 15 * integer(5), roomId: rooms[integer(roomCount)].id,
      earliestStart, latestStart, eligibleRoomIds,
      resourceIds: resources.filter(() => random() < 0.32).map(resource => resource.id),
      pinned: random() < 0.14,
    };
  });
  const blackouts = [];
  for (let index = 0, count = integer(3); index < count; index++) {
    const type = random() < 0.5 ? 'room' : 'resource';
    const targets = type === 'room' ? rooms : resources;
    const start = 540 + integer(65);
    blackouts.push({ id: `closure${index}`, type, targetId: targets[integer(targets.length)].id, start, end: start + 5 + integer(21) });
  }
  return { version: 1, title: `Synthetic differential seed ${seed}`, day: { start: 540, end: 660, step: 15 }, rooms, resources, sessions, blackouts };
}
