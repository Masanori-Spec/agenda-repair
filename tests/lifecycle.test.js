import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageLifecycle} from '../src/lifecycle.js';
function fixture(initialRunning = false) {
  const state = {running: initialRunning, worker: initialRunning, proposal: null, progress: 512, serial: 1, status: initialRunning ? 'exploring' : 'idle', restores: 0};
  const lifecycle = createPageLifecycle({
    isRunning: () => state.running,
    interrupt: () => {state.running = false; state.worker = false; state.proposal = null; state.progress = null; state.serial++; state.status = 'interrupted';},
    dispose: () => {state.worker = false; state.running = false;},
    restore: () => {state.restores++; state.status = 'interrupted: retry available';},
  });
  return {state, lifecycle};
}
test('initial pageshow does not report a nonexistent interrupted run', () => {
  const {state,lifecycle}=fixture(); lifecycle.pageshow();
  assert.equal(state.restores,0); assert.equal(state.status,'idle');
});
test('pagehide during a run disposes pending work and restores a retryable state', () => {
  const {state,lifecycle}=fixture(true); lifecycle.pagehide();
  assert.equal(state.worker,false); assert.equal(state.running,false); assert.equal(state.proposal,null); assert.equal(state.progress,null); assert.equal(state.serial,2);
  lifecycle.pageshow(); assert.equal(state.restores,1); assert.equal(state.status,'interrupted: retry available');
});
test('duplicate hide or show notifications do not lose or repeat interruption recovery', () => {
  const {state,lifecycle}=fixture(true); lifecycle.pagehide(); lifecycle.pagehide(); lifecycle.pageshow(); lifecycle.pageshow();
  assert.equal(state.restores,1); assert.equal(state.serial,2);
});
test('completed proposals survive idle pagehide and pageshow', () => {
  const {state,lifecycle}=fixture(); state.proposal={status:'optimal'}; state.status='complete';
  lifecycle.pagehide(); lifecycle.pageshow();
  assert.deepEqual(state.proposal,{status:'optimal'}); assert.equal(state.status,'complete'); assert.equal(state.restores,0);
});
test('a new run can be interrupted and recovered again after restoration', () => {
  const {state,lifecycle}=fixture(true); lifecycle.pagehide(); lifecycle.pageshow(); state.running=true; state.worker=true; lifecycle.pagehide(); lifecycle.pageshow();
  assert.equal(state.restores,2); assert.equal(state.serial,3); assert.equal(state.running,false);
});
