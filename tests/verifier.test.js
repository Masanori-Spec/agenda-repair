import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAssignments} from '../src/verify.js';
const session=(id,start,roomId,extra={})=>({id,title:id,duration:20,start,roomId,earliestStart:540,latestStart:640,eligibleRoomIds:['a','b'],resourceIds:[],pinned:false,...extra});
const base=()=>({version:1,title:'Verifier',day:{start:540,end:720,step:10},rooms:[{id:'a',label:'A'},{id:'b',label:'B'}],resources:[{id:'kit',label:'Kit'}],sessions:[session('s1',540,'a'),session('s2',560,'a')],blackouts:[]});
const assignment=p=>p.sessions.map(({id,start,roomId})=>({id,start,roomId}));
test('verifier accepts touching half-open intervals',()=>{const p=base();assert.equal(verifyAssignments(p,assignment(p)).ok,true);});
for(const [name,mutate] of [
  ['missing session',(p,a)=>a.pop()],['duplicate session',(p,a)=>a[1]={...a[0]}],['unknown session',(p,a)=>a[1].id='unknown'],
  ['fractional minute',(p,a)=>a[1].start=560.5],['off-grid minute',(p,a)=>a[1].start=561],['outside day',(p,a)=>a[1].start=720],
  ['start window',(p,a)=>a[1].start=650],['ineligible room',(p,a)=>a[1].roomId='c'],['room overlap',(p,a)=>a[1].start=550],
  ['pin modification',(p,a)=>{p.sessions[1].pinned=true;a[1].roomId='b';}],
  ['room blackout',(p,a)=>p.blackouts.push({id:'x',type:'room',targetId:'a',start:550,end:580})],
  ['equipment across rooms',(p,a)=>{p.sessions.forEach(s=>s.resourceIds=['kit']);a[1].start=550;a[1].roomId='b';}],
  ['equipment blackout',(p,a)=>{p.sessions[0].resourceIds=['kit'];p.blackouts.push({id:'x',type:'resource',targetId:'kit',start:550,end:560});}],
  ['unexpected field',(p,a)=>a[0].duration=1],['NaN start',(p,a)=>a[0].start=NaN],['null placement',(p,a)=>a[0]=null]
]) test(`verifier rejects ${name}`,()=>{const p=base(),a=assignment(p);mutate(p,a);assert.equal(verifyAssignments(p,a).ok,false);});
