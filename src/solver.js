import {validateProblem, LIMITS} from './model.js';
const lex = (a,b) => { for (let i=0;i<a.length;i++) { if(a[i]!==b[i]) return a[i]<b[i]?-1:1; } return 0; };
const intersect = (a,b) => a.start < b.end && b.start < a.end;
/** Finite-domain, deterministic, bounded depth-first branch-and-bound. */
export async function solve(input, {nodeBudget=LIMITS.defaultNodeBudget,shouldCancel=()=>false,onProgress=()=>{},yieldEvery=512}={}) {
  const parsed=validateProblem(input);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  if (!Number.isSafeInteger(nodeBudget) || nodeBudget < 0 || nodeBudget > LIMITS.maxNodeBudget) throw new Error('nodeBudget out of bounds');
  if (!Number.isSafeInteger(yieldEvery) || yieldEvery < 1) throw new Error('yieldEvery must be a positive integer');
  const p=parsed.value, sessions=p.sessions, roomRanks=new Map(p.rooms.map((r,i)=>[r.id,i]));
  let nodes=0, reason='complete', incumbent=null, best=null;
  const diagnostics=[];
  const result = () => ({status:reason==='complete'?(incumbent?'optimal':'infeasible'):(incumbent?'feasible':'unknown'),reason,assignments:incumbent,objective:best?{changedSessions:best[0],totalShiftMinutes:best[1],roomChanges:best[2],tieBreak:best.slice(3)}:null,nodes,diagnostics});
  if (shouldCancel()) { reason='cancelled'; return result(); }
  const candidates=sessions.map(s=> {
    const list=[];
    for (let start=s.earliestStart; start<=s.latestStart; start+=p.day.step) for (const roomId of s.eligibleRoomIds) {
      if (s.pinned && (s.start!==start || s.roomId!==roomId)) continue;
      const c={id:s.id,start,roomId,end:start+s.duration,cost:[Number(start!==s.start || roomId!==s.roomId),Math.abs(start-s.start),Number(roomId!==s.roomId)]};
      if (p.blackouts.some(b=>(b.type==='room'?b.targetId===roomId:s.resourceIds.includes(b.targetId)) && intersect(c,b))) continue;
      list.push(c);
    }
    list.sort((a,b)=>lex([...a.cost,a.start,roomRanks.get(a.roomId)],[...b.cost,b.start,roomRanks.get(b.roomId)]));
    return list;
  });
  for (let i=0;i<sessions.length;i++) if (!candidates[i].length) diagnostics.push(`${sessions[i].id}: 固定・開始範囲・会場候補・使用不可時間を満たす配置がありません`);
  if (diagnostics.length) return result();
  const share=sessions.map(s=>sessions.map(t=>s.resourceIds.some(r=>t.resourceIds.includes(r))));
  const conflict=(i,a,j,b)=>(a.roomId===b.roomId || share[i][j]) && intersect(a,b);
  const placed=new Array(sessions.length).fill(null);
  const feasibleWithPlaced=(i,c)=>placed.every((other,j)=>!other || j===i || !conflict(i,c,j,other));
  const score=cost=>[...cost,...placed.flatMap(c=>[c.start,roomRanks.get(c.roomId)])];
  const save=cost=>{
    const full=score(cost);
    if(!best || lex(full,best)<0) {best=full;incumbent=placed.map(({id,start,roomId})=>({id,start,roomId}));}
  };
  // Zero disruptions is a global lower bound and uniquely identifies the baseline.
  const baseline=candidates.map((list,i)=>list.find(c=>c.start===sessions[i].start && c.roomId===sessions[i].roomId));
  if(baseline.every(Boolean) && baseline.every((a,i)=>baseline.every((b,j)=>i>=j || !conflict(i,a,j,b)))) {
    baseline.forEach((c,i)=>{placed[i]=c;}); save([0,0,0]); return result();
  }
  for(let i=0;i<sessions.length;i++) if(sessions[i].pinned) {
    if(!feasibleWithPlaced(i,candidates[i][0])) {diagnostics.push('固定された枠同士に会場または共有備品の重複があります');return result();}
    placed[i]=candidates[i][0];
  }
  const dfs=async(cost,remaining)=>{
    if(reason!=='complete') return;
    if(shouldCancel()) {reason='cancelled';return;}
    if(nodes>=nodeBudget) {reason='budget';return;}
    nodes++;
    if(nodes%yieldEvery===0) {
      onProgress({nodes,objective:best?{changedSessions:best[0],totalShiftMinutes:best[1],roomChanges:best[2],tieBreak:best.slice(3)}:null});
      await new Promise(resolve=>setTimeout(resolve,0));
      if(shouldCancel()) {reason='cancelled';return;}
    }
    if(!remaining) {save(cost);return;}
    let chosen=-1, choices=null;
    const lower=[...cost];
    for(let i=0;i<sessions.length;i++) if(!placed[i]) {
      const legal=candidates[i].filter(c=>feasibleWithPlaced(i,c));
      if(!legal.length) return;
      // Sorted domains make this the lexicographic per-variable minimum.
      for(let k=0;k<3;k++) lower[k]+=legal[0].cost[k];
      if(choices===null || legal.length<choices.length) {chosen=i;choices=legal;}
    }
    if(best && lex(lower,best.slice(0,3))>0) return;
    for(const c of choices) {
      const next=cost.map((v,k)=>v+c.cost[k]);
      if(best && lex(next,best.slice(0,3))>0) continue;
      placed[chosen]=c;
      await dfs(next,remaining-1);
      placed[chosen]=null;
      if(reason!=='complete') return;
    }
  };
  await dfs([0,0,0],sessions.filter(s=>!s.pinned).length);
  if(reason==='complete' && !incumbent) diagnostics.push('全候補を探索しましたが、この条件を同時に満たす配置はありません（最小矛盾集合の証明ではありません）');
  return result();
}
