/** Independent output verifier. Does not use solver domain/overlap/objective helpers. */
export function verifyAssignments(problem, assignments) {
  const errors = [];
  if (!Array.isArray(assignments)) return {ok:false,errors:['提案の配置配列がありません']};
  if (assignments.length !== problem.sessions.length) errors.push('セッション件数が一致しません');
  const seen = new Set();
  const actual = new Map();
  for (const a of assignments) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).length !== 3 || !Object.hasOwn(a,'id') || !Object.hasOwn(a,'start') || !Object.hasOwn(a,'roomId')) { errors.push('配置の形式が不正です'); continue; }
    if (seen.has(a.id)) errors.push(`重複した配置: ${a.id}`);
    seen.add(a.id); actual.set(a.id,a);
    if (!problem.sessions.some(s=>s.id===a.id)) errors.push(`未登録の配置: ${a.id}`);
  }
  for (const s of problem.sessions) {
    const a = actual.get(s.id); if (!a) { errors.push(`配置がありません: ${s.id}`); continue; }
    if (!Number.isSafeInteger(a.start) || a.start < problem.day.start || a.start+s.duration > problem.day.end || (a.start-problem.day.start)%problem.day.step!==0) errors.push(`開催時間またはグリッド違反: ${s.id}`);
    if (a.start < s.earliestStart || a.start > s.latestStart) errors.push(`開始可能範囲違反: ${s.id}`);
    if (!s.eligibleRoomIds.includes(a.roomId)) errors.push(`会場候補違反: ${s.id}`);
    if (s.pinned && (a.start!==s.start || a.roomId!==s.roomId)) errors.push(`固定違反: ${s.id}`);
    for (const b of problem.blackouts) {
      const applies = b.type==='room' ? b.targetId===a.roomId : s.resourceIds.includes(b.targetId);
      if (applies && a.start < b.end && b.start < a.start+s.duration) errors.push(`使用不可時間との衝突: ${s.id} / ${b.id}`);
    }
  }
  for (let i=0;i<problem.sessions.length;i++) for (let j=i+1;j<problem.sessions.length;j++) {
    const s=problem.sessions[i], t=problem.sessions[j], a=actual.get(s.id), b=actual.get(t.id);
    if (!a || !b) continue;
    if (a.start < b.start+t.duration && b.start < a.start+s.duration) {
      if (a.roomId===b.roomId) errors.push(`会場の重複: ${s.id} / ${t.id}`);
      for (const r of s.resourceIds) if (t.resourceIds.includes(r)) errors.push(`共有備品の重複: ${s.id} / ${t.id} / ${r}`);
    }
  }
  return {ok:errors.length===0,errors};
}
