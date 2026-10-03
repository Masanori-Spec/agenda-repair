export const LIMITS = Object.freeze({ sessions: 20, movable: 8, rooms: 6, resources: 8, blackouts: 24, domainPerSession: 120, importBytes: 100_000, defaultNodeBudget: 200_000, maxNodeBudget: 2_000_000 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const TEXT = /^[^\u0000-\u001f\u007f-\u009f]{1,120}$/u;
const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function validateProblem(input) {
  const errors = [];
  const fail = message => { if (errors.length < 30) errors.push(message); };
  const object = (x, keys, path) => {
    if (!x || typeof x !== 'object' || Array.isArray(x) || (Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null)) { fail(`${path}: オブジェクトが必要です`); return false; }
    const actual = Object.keys(x);
    if (actual.some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(x, k))) { fail(`${path}: 必須項目の不足または未対応の項目があります`); return false; }
    return true;
  };
  const integer = (n, min, max, path) => { const ok = Number.isSafeInteger(n) && n >= min && n <= max; if (!ok) fail(`${path}: ${min}〜${max}の整数が必要です`); return ok; };
  const label = (v, path) => { if (typeof v !== 'string' || !TEXT.test(v)) fail(`${path}: 制御文字を除く1〜120文字が必要です`); };
  const id = (v, path) => { if (typeof v !== 'string' || !ID.test(v)) fail(`${path}: 1〜40文字の半角英数字・ハイフン・アンダースコアが必要です`); };
  const array = (v, min, max, path) => { const ok = Array.isArray(v) && v.length >= min && v.length <= max; if (!ok) fail(`${path}: ${min}〜${max}件の配列が必要です`); return ok; };
  if (!object(input, ['version','title','day','rooms','resources','sessions','blackouts'], '入力')) return { ok: false, errors };
  if (input.version !== 1) fail('version: 対応する形式は1です');
  label(input.title, 'title');
  if (!object(input.day, ['start','end','step'], 'day')) return { ok: false, errors };
  integer(input.day.start, 0, 1439, 'day.start'); integer(input.day.end, 1, 1440, 'day.end'); integer(input.day.step, 1, 60, 'day.step');
  if (errors.length) return { ok: false, errors };
  if (input.day.start >= input.day.end) fail('day: 開始は終了より前にしてください');
  const grid = (n, p) => { if (Number.isSafeInteger(n) && (n - input.day.start) % input.day.step !== 0) fail(`${p}: day.startを起点とするグリッドに合わせてください`); };
  const roomIds = new Set(), resourceIds = new Set(), sessionIds = new Set(), blackoutIds = new Set();
  for (const [field, max, min, set] of [['rooms',LIMITS.rooms,1,roomIds],['resources',LIMITS.resources,0,resourceIds]]) {
    if (array(input[field], min, max, field)) for (const [i,x] of input[field].entries()) {
      const p = `${field}[${i}]`; if (!object(x,['id','label'],p)) continue; id(x.id,`${p}.id`); label(x.label,`${p}.label`);
      if (set.has(x.id)) fail(`${p}: IDが重複しています`); set.add(x.id);
    }
  }
  let movable = 0;
  if (array(input.sessions, 1, LIMITS.sessions, 'sessions')) for (const [i,s] of input.sessions.entries()) {
    const p = `sessions[${i}]`;
    if (!object(s,['id','title','duration','start','roomId','earliestStart','latestStart','eligibleRoomIds','resourceIds','pinned'],p)) continue;
    id(s.id,`${p}.id`); label(s.title,`${p}.title`);
    if (sessionIds.has(s.id)) fail(`${p}: IDが重複しています`); sessionIds.add(s.id);
    integer(s.duration,1,1440,`${p}.duration`);
    for (const k of ['start','earliestStart','latestStart']) { integer(s[k],input.day.start,input.day.end-1,`${p}.${k}`); grid(s[k],`${p}.${k}`); }
    if ([s.start,s.duration,s.latestStart].every(Number.isSafeInteger) && (s.start+s.duration > input.day.end || s.latestStart+s.duration > input.day.end)) fail(`${p}: 所要時間が開催時間を超えています`);
    if (Number.isSafeInteger(s.earliestStart) && Number.isSafeInteger(s.latestStart) && s.earliestStart > s.latestStart) fail(`${p}: 開始可能範囲の前後が逆です`);
    if (!roomIds.has(s.roomId)) fail(`${p}.roomId: 未登録の会場です`);
    for (const [field,set,min,max] of [['eligibleRoomIds',roomIds,1,LIMITS.rooms],['resourceIds',resourceIds,0,LIMITS.resources]]) {
      if (array(s[field],min,max,`${p}.${field}`)) {
        if (new Set(s[field]).size !== s[field].length) fail(`${p}.${field}: IDが重複しています`);
        for (const v of s[field]) if (!set.has(v)) fail(`${p}.${field}: 未登録のIDです`);
      }
    }
    if (typeof s.pinned !== 'boolean') fail(`${p}.pinned: trueまたはfalseが必要です`);
    if (s.pinned === false) {
      movable++;
      if (Number.isSafeInteger(s.earliestStart) && Number.isSafeInteger(s.latestStart) && Array.isArray(s.eligibleRoomIds) && (1 + (s.latestStart-s.earliestStart)/input.day.step)*s.eligibleRoomIds.length > LIMITS.domainPerSession) fail(`${p}: 候補配置は${LIMITS.domainPerSession}件以内にしてください`);
    }
  }
  if (movable > LIMITS.movable) fail(`sessions: 変更可能な枠は${LIMITS.movable}件以内にしてください`);
  if (array(input.blackouts,0,LIMITS.blackouts,'blackouts')) for (const [i,b] of input.blackouts.entries()) {
    const p = `blackouts[${i}]`; if (!object(b,['id','type','targetId','start','end'],p)) continue;
    id(b.id,`${p}.id`); if (blackoutIds.has(b.id)) fail(`${p}: IDが重複しています`); blackoutIds.add(b.id);
    if (b.type !== 'room' && b.type !== 'resource') fail(`${p}.type: roomまたはresourceが必要です`);
    else if (!(b.type === 'room' ? roomIds : resourceIds).has(b.targetId)) fail(`${p}.targetId: 未登録のIDです`);
    integer(b.start,input.day.start,input.day.end-1,`${p}.start`); integer(b.end,input.day.start+1,input.day.end,`${p}.end`);
    if (Number.isSafeInteger(b.start) && Number.isSafeInteger(b.end) && b.start >= b.end) fail(`${p}: 開始は終了より前にしてください`);
  }
  if (errors.length) return { ok: false, errors };
  const value = structuredClone(input);
  for (const field of ['rooms','resources','sessions','blackouts']) value[field].sort((a,b)=>ascii(a.id,b.id));
  for (const s of value.sessions) { s.eligibleRoomIds.sort(ascii); s.resourceIds.sort(ascii); }
  return { ok: true, value };
}
export function parseProblem(text) {
  if (typeof text !== 'string') return {ok:false,errors:['JSONテキストが必要です']};
  if (new TextEncoder().encode(text).length > LIMITS.importBytes) return {ok:false,errors:['JSONは100KB以内にしてください']};
  try { return validateProblem(JSON.parse(text)); } catch { return {ok:false,errors:['JSONを読み取れません。構文を確認してください']}; }
}
export function minuteLabel(n) { return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
export function baselineAssignments(problem) { return problem.sessions.map(s=>({id:s.id,start:s.start,roomId:s.roomId})); }
export function summarizeChanges(problem, assignments) {
  const byId = new Map(assignments.map(a=>[a.id,a]));
  return problem.sessions.filter(s=>byId.has(s.id)).map(s=>({id:s.id,title:s.title,from:{start:s.start,roomId:s.roomId},to:{start:byId.get(s.id).start,roomId:byId.get(s.id).roomId},shiftMinutes:byId.get(s.id).start-s.start,duration:s.duration})).filter(c=>c.from.start!==c.to.start || c.from.roomId!==c.to.roomId);
}
