import { DEMOS } from './demos.js';
import { createPageLifecycle } from './lifecycle.js';
import { validateProblem, parseProblem, minuteLabel, baselineAssignments, summarizeChanges, LIMITS } from './model.js';
import { verifyAssignments } from './verify.js';

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const state = { problem: null, demoId: null, proposal: null, worker: null, serial: 0, activeId: null, running: false };
let importEpoch = 0;
const format = (n) => n.toLocaleString('ja-JP');
const roomName = (id) => state.problem.rooms.find((room) => room.id === id)?.label || id;
const resourceName = (id) => state.problem.resources.find((resource) => resource.id === id)?.label || id;
const timeRange = (start, duration) => `${minuteLabel(start)}–${minuteLabel(start + duration)}`;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

function showNotice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function showErrors(target, messages, heading = '') {
  target.replaceChildren();
  target.hidden = !messages.length;
  if (!messages.length) return;
  if (heading) target.append(el('strong', '', heading));
  const list = el('ul');
  for (const message of messages.slice(0, 24)) list.append(el('li', '', message));
  if (messages.length > 24) list.append(el('li', '', `ほか ${messages.length - 24} 件のエラー`));
  target.append(list);
}
function setStatus(message, type = 'idle') {
  $('solve-status-text').textContent = message;
  document.querySelector('.status-strip').dataset.state = type;
}
function setRunning(running) {
  state.running = running;
  $('solve').disabled = running || !state.problem;
  $('solve').hidden = running;
  $('cancel').hidden = !running;
  $('cancel').disabled = false;
  $('cancel').textContent = '探索を停止';
  $('node-budget').disabled = running;
}
function terminateWorker() {
  state.activeId = null;
  if (state.worker) state.worker.terminate();
  state.worker = null;
  setRunning(false);
}
function invalidateProposal(message) {
  terminateWorker();
  state.serial += 1;
  state.proposal = null;
  $('progress').textContent = '— nodes';
  setStatus(message || 'まだ探索していません');
}
function applyProblem(problem, demoId = null, message = '') {
  state.problem = problem;
  state.demoId = demoId;
  invalidateProposal(message ? '条件が変わりました。修復案を再計算してください' : 'まだ探索していません');
  showErrors($('error-notice'), []);
  $('blackout-error').hidden = true;
  renderDemos();
  renderProblem();
  renderProposal();
  showNotice(message);
}
function mutateProblem(candidate, successMessage) {
  const checked = validateProblem(candidate);
  if (!checked.ok) return checked;
  applyProblem(checked.value, null, successMessage);
  return checked;
}
function renderDemos() {
  $('demo-list').replaceChildren();
  for (const [index, demo] of DEMOS.entries()) {
    const button = el('button', 'demo-card');
    button.type = 'button';
    button.id = `demo-${demo.id}`;
    button.setAttribute('aria-pressed', String(state.demoId === demo.id));
    const top = el('span', 'demo-top');
    top.append(el('span', 'demo-number', String(index + 1).padStart(2, '0')), el('span', 'demo-label', demo.label));
    const check = el('span', 'demo-check', '✓');
    check.setAttribute('aria-hidden', 'true');
    top.append(check);
    button.append(top, el('span', 'demo-description', demo.description));
    button.addEventListener('click', () => {
      const checked = validateProblem(demo.problem);
      if (!checked.ok) return showErrors($('error-notice'), checked.errors, 'サンプルを読み込めませんでした');
      applyProblem(checked.value, demo.id, '架空のサンプルを読み込みました。元の配置と条件を確認して、探索を開始できます。');
      $(`demo-${demo.id}`).focus({ preventScroll: true });
    });
    $('demo-list').append(button);
  }
}
function getConflicts(assignments) {
  const conflicts = new Set();
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  for (const session of state.problem.sessions) {
    const assignment = byId.get(session.id);
    if (!assignment) { conflicts.add(session.id); continue; }
    if (assignment.start < session.earliestStart || assignment.start > session.latestStart || !session.eligibleRoomIds.includes(assignment.roomId)) conflicts.add(session.id);
    for (const blackout of state.problem.blackouts) {
      const applies = blackout.type === 'room' ? blackout.targetId === assignment.roomId : session.resourceIds.includes(blackout.targetId);
      if (applies && overlaps({ start: assignment.start, end: assignment.start + session.duration }, blackout)) conflicts.add(session.id);
    }
  }
  for (let i = 0; i < state.problem.sessions.length; i += 1) {
    for (let j = i + 1; j < state.problem.sessions.length; j += 1) {
      const a = state.problem.sessions[i], b = state.problem.sessions[j];
      const pa = byId.get(a.id), pb = byId.get(b.id);
      if (!pa || !pb) continue;
      if (overlaps({ start: pa.start, end: pa.start + a.duration }, { start: pb.start, end: pb.start + b.duration }) && (pa.roomId === pb.roomId || a.resourceIds.some((id) => b.resourceIds.includes(id)))) {
        conflicts.add(a.id); conflicts.add(b.id);
      }
    }
  }
  return conflicts;
}
function renderTimeline(container, assignments, proposed = false) {
  container.replaceChildren();
  const problem = state.problem;
  const timeline = el('div', 'timeline');
  const axis = el('div', 'timeline-axis');
  const dayDuration = problem.day.end - problem.day.start;
  for (let i = 0; i <= 4; i += 1) {
    const label = el('span', 'axis-label', minuteLabel(Math.round(problem.day.start + dayDuration * i / 4)));
    label.style.left = `${i * 25}%`;
    axis.append(label);
  }
  timeline.append(axis);
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const conflicts = proposed ? new Set() : getConflicts(assignments);
  for (const room of problem.rooms) {
    const lane = el('div', 'room-lane');
    lane.append(el('div', 'room-label', room.label));
    const track = el('div', 'lane-track');
    const sessions = problem.sessions.filter((session) => byId.get(session.id)?.roomId === room.id).sort((a, b) => byId.get(a.id).start - byId.get(b.id).start || a.id.localeCompare(b.id));
    const rowEnds = [];
    const positions = [];
    for (const session of sessions) {
      const assignment = byId.get(session.id);
      let row = rowEnds.findIndex((end) => end <= assignment.start);
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = assignment.start + session.duration;
      positions.push({ session, assignment, row });
    }
    track.style.height = `${Math.max(1, rowEnds.length) * 46 + 3}px`;
    for (const blackout of problem.blackouts.filter((item) => item.type === 'room' && item.targetId === room.id)) {
      const block = el('div', 'blackout-bar');
      block.style.left = `${(blackout.start - problem.day.start) / dayDuration * 100}%`;
      block.style.width = `${(blackout.end - blackout.start) / dayDuration * 100}%`;
      block.title = `${room.label} 利用不可 ${minuteLabel(blackout.start)}–${minuteLabel(blackout.end)}`;
      block.setAttribute('role', 'img');
      block.setAttribute('aria-label', block.title);
      block.append(el('span', 'blackout-label', '利用不可'));
      track.append(block);
    }
    for (const { session, assignment, row } of positions) {
      const changed = assignment.start !== session.start || assignment.roomId !== session.roomId;
      const classes = ['session-bar', session.pinned && 'pinned', proposed && changed && 'changed', conflicts.has(session.id) && 'conflict'].filter(Boolean).join(' ');
      const bar = el('div', classes);
      bar.style.left = `${(assignment.start - problem.day.start) / dayDuration * 100}%`;
      bar.style.width = `${session.duration / dayDuration * 100}%`;
      bar.style.top = `${row * 46 + 2}px`;
      const label = `${session.title}、${room.label}、${timeRange(assignment.start, session.duration)}${session.pinned ? '、固定' : ''}${changed ? '、変更あり' : ''}${conflicts.has(session.id) ? '、条件との衝突あり' : ''}`;
      bar.title = label;
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', label);
      bar.append(el('strong', '', `${session.pinned ? '● ' : ''}${session.title}`), el('small', '', timeRange(assignment.start, session.duration)));
      track.append(bar);
    }
    lane.append(track); timeline.append(lane);
  }
  const resourceBlackouts = problem.blackouts.filter((item) => item.type === 'resource');
  if (resourceBlackouts.length) {
    const notes = el('div', 'resource-notes');
    for (const blackout of resourceBlackouts) notes.append(el('p', '', `機材停止：${resourceName(blackout.targetId)} ${minuteLabel(blackout.start)}–${minuteLabel(blackout.end)}`));
    timeline.append(notes);
  }
  container.append(timeline);
}
function renderProblem() {
  const problem = state.problem;
  $('project-title').textContent = problem.title;
  $('project-meta').textContent = `${minuteLabel(problem.day.start)}–${minuteLabel(problem.day.end)}　/　${problem.sessions.length}件の予定　/　${problem.rooms.length}会場　/　${problem.day.step}分刻み`;
  $('export-baseline').disabled = false;
  const assignments = baselineAssignments(problem);
  const checked = verifyAssignments(problem, assignments);
  $('baseline-badge').textContent = checked.ok ? '条件を満たしています' : `要確認 ${checked.errors.length}件`;
  $('baseline-badge').className = `badge ${checked.ok ? 'badge-success' : 'badge-warning'}`;
  renderTimeline($('baseline-timeline'), assignments);
  $('baseline-issues').replaceChildren();
  if (!checked.ok) {
    const details = el('details');
    details.append(el('summary', '', `元の配置の条件違反を確認（${checked.errors.length}件）`));
    const list = el('ul');
    for (const error of checked.errors) list.append(el('li', '', error));
    details.append(list); $('baseline-issues').append(details);
  } else $('baseline-issues').append(el('span', '', '元の配置は、現在の条件をすべて満たしています。'));
  renderSessions();
  renderBlackouts();
  renderBlackoutTargets();
  $('blackout-start').value = minuteLabel(problem.day.start);
  $('blackout-end').value = minuteLabel(Math.min(problem.day.end, problem.day.start + 60));
}
function renderSessions() {
  const container = $('session-list');
  container.replaceChildren();
  const sessions = [...state.problem.sessions].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  $('session-count').textContent = `${sessions.filter((session) => session.pinned).length}件を固定`;
  for (const session of sessions) {
    const row = el('div', 'session-item');
    const details = el('details');
    const summary = el('summary');
    const title = el('span', 'session-summary', session.title);
    title.append(el('small', '', `${timeRange(session.start, session.duration)} · ${roomName(session.roomId)} · ${session.duration}分`));
    summary.append(title);
    const definitions = el('dl', 'session-constraints');
    const entries = [
      ['ID', session.id],
      ['開始可能', `${minuteLabel(session.earliestStart)}–${minuteLabel(session.latestStart)}（${state.problem.day.step}分刻み）`],
      ['使える会場', session.eligibleRoomIds.map(roomName).join('、')],
      ['共用する機材', session.resourceIds.length ? session.resourceIds.map(resourceName).join('、') : 'なし'],
      ['固定条件', session.pinned ? '元の開始時刻と会場を維持' : '許可された候補内で移動可能'],
    ];
    for (const [term, definition] of entries) definitions.append(el('dt', '', term), el('dd', '', definition));
    const pinLabel = el('label', 'pin-toggle');
    const checkbox = el('input');
    checkbox.type = 'checkbox'; checkbox.checked = session.pinned; checkbox.id = `pin-${session.id}`;
    checkbox.setAttribute('aria-label', `${session.title}を固定`);
    checkbox.addEventListener('change', () => {
      const wasOpen = details.open;
      const next = structuredClone(state.problem);
      next.sessions.find((item) => item.id === session.id).pinned = checkbox.checked;
      const result = mutateProblem(next, `${session.title}の固定を${checkbox.checked ? '設定' : '解除'}しました。修復案を再計算してください。`);
      if (!result.ok) { checkbox.checked = session.pinned; return showErrors($('error-notice'), result.errors, '固定条件を変更できませんでした'); }
      const newCheckbox = $(`pin-${session.id}`);
      newCheckbox.closest('.session-item').querySelector('details').open = wasOpen;
      newCheckbox.focus({ preventScroll: true });
    });
    pinLabel.append(checkbox, document.createTextNode('固定'));
    details.append(summary, definitions); row.append(details, pinLabel); container.append(row);
  }
}
function renderBlackoutTargets() {
  const type = $('blackout-type').value;
  const items = type === 'room' ? state.problem.rooms : state.problem.resources;
  $('blackout-target').replaceChildren();
  for (const item of items) {
    const option = el('option', '', item.label); option.value = item.id;
    $('blackout-target').append(option);
  }
  if (!items.length) {
    const option = el('option', '', '登録された機材はありません'); option.value = '';
    $('blackout-target').append(option);
  }
  $('blackout-target').disabled = !items.length;
  $('add-blackout').disabled = !items.length || state.problem.blackouts.length >= LIMITS.blackouts;
}
function renderBlackouts() {
  $('blackout-count').textContent = `${state.problem.blackouts.length}件`;
  $('blackout-list').replaceChildren();
  if (!state.problem.blackouts.length) $('blackout-list').append(el('li', 'list-empty', '利用不可の時間帯は、まだありません。'));
  for (const blackout of [...state.problem.blackouts].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))) {
    const label = blackout.type === 'room' ? roomName(blackout.targetId) : resourceName(blackout.targetId);
    const row = el('li', 'blackout-item');
    const description = el('div');
    description.append(el('strong', '', `${label} · ${minuteLabel(blackout.start)}–${minuteLabel(blackout.end)}`), el('small', '', `${blackout.type === 'room' ? '会場' : '機材'}の利用不可`));
    const remove = el('button', 'remove-blackout', '削除'); remove.type = 'button';
    remove.setAttribute('aria-label', `${label} ${minuteLabel(blackout.start)}から${minuteLabel(blackout.end)}の利用不可を削除`);
    remove.addEventListener('click', () => {
      const next = structuredClone(state.problem); next.blackouts = next.blackouts.filter((item) => item.id !== blackout.id);
      const result = mutateProblem(next, `${label}の利用不可を削除しました。修復案を再計算してください。`);
      if (!result.ok) return showErrors($('error-notice'), result.errors, '削除できませんでした');
      $('blackout-type').focus({ preventScroll: true });
    });
    row.append(description, remove); $('blackout-list').append(row);
  }
}
function emptyProposal(title, description, glyph = '▥') {
  const empty = el('div', 'empty-state');
  const icon = el('span', 'empty-glyph', glyph); icon.setAttribute('aria-hidden', 'true');
  empty.append(icon, el('strong', '', title), el('p', '', description));
  $('proposal-timeline').replaceChildren(empty);
}
function metric(id, number, unit) {
  const target = $(id); target.classList.toggle('metric-large', number !== null && number >= 1000); target.replaceChildren(document.createTextNode(number === null ? '—' : format(number)), el('small', '', unit));
}
function renderProposal() {
  const result = state.proposal;
  $('export-proposal').disabled = !result?.assignments;
  $('proposal-badge').className = 'badge';
  $('result-details').textContent = '';
  $('changes').className = 'changes-empty';
  $('changes').replaceChildren();
  metric('metric-count', null, '件'); metric('metric-shift', null, '分'); metric('metric-rooms', null, '件');
  if (!result) {
    $('proposal-badge').textContent = '未計算';
    $('proposal-description').textContent = '探索が終わると、独立検証済みの配置を表示します。';
    emptyProposal('次の予定を、ここに。', '必要な条件を調整して「修復案を探す」を押してください');
    $('changes').textContent = 'まだ変更はありません。探索結果の差分がここに並びます。';
    return;
  }
  const reasonText = { complete: '探索完了', budget: '探索上限に到達', cancelled: '利用者が探索を停止' }[result.reason] || result.reason;
  $('result-details').textContent = `${reasonText} · ${format(result.nodes)}ノードを探索${result.diagnostics?.length ? `。${result.diagnostics.join(' / ')}` : ''}`;
  if (!result.assignments) {
    const impossible = result.status === 'infeasible';
    $('proposal-badge').textContent = impossible ? '実行不能を確認' : '結論は未確定';
    $('proposal-badge').className = `badge ${impossible ? 'badge-error' : 'badge-warning'}`;
    $('proposal-description').textContent = impossible ? '現在の条件をすべて満たす配置がないことを確認しました。' : '探索を終える前に停止しました。実行不能とは限りません。';
    emptyProposal(impossible ? 'この条件では、組めません。' : 'まだ有効な案を見つけていません。', impossible ? '固定の解除や利用不可の条件を見直して、もう一度探索してください。' : '探索上限を増やすか、条件を見直して再探索してください。', impossible ? '↔' : '…');
    $('changes').textContent = '有効な修復案がないため、差分とダウンロードはありません。';
    return;
  }
  const optimal = result.status === 'optimal';
  $('proposal-badge').textContent = optimal ? '最適性を確認' : '最適性未証明';
  $('proposal-badge').className = `badge ${optimal ? 'badge-success' : 'badge-warning'}`;
  $('proposal-description').textContent = optimal ? 'すべての条件を独立検証済み。優先順に最小の変更です。' : 'すべての条件を独立検証済み。さらに良い案がある可能性があります。';
  renderTimeline($('proposal-timeline'), result.assignments, true);
  const changes = summarizeChanges(state.problem, result.assignments).sort((a, b) => a.from.start - b.from.start || a.id.localeCompare(b.id));
  metric('metric-count', changes.length, '件');
  metric('metric-shift', changes.reduce((sum, item) => sum + Math.abs(item.shiftMinutes), 0), '分');
  metric('metric-rooms', changes.filter((item) => item.from.roomId !== item.to.roomId).length, '件');
  if (!changes.length) {
    $('changes').textContent = '変更は0件。元の予定のままで、すべての条件を満たします。';
    return;
  }
  $('changes').className = '';
  const list = el('ul', 'change-list');
  for (const change of changes) {
    const row = el('li', 'change-row');
    const title = el('div', 'change-title', change.title); title.append(el('span', 'change-id', change.id));
    const path = el('div', 'change-path');
    const from = el('span', 'change-from', `${timeRange(change.from.start, change.duration)} · ${roomName(change.from.roomId)}`);
    const arrow = el('span', 'change-arrow', '→'); arrow.setAttribute('aria-label', 'から');
    const to = el('span', 'change-to', `${timeRange(change.to.start, change.duration)} · ${roomName(change.to.roomId)}`);
    path.append(from, arrow, to);
    let shift = change.shiftMinutes === 0 ? '時刻はそのまま' : `${Math.abs(change.shiftMinutes)}分${change.shiftMinutes > 0 ? '後ろへ' : '前へ'}`;
    if (change.from.roomId !== change.to.roomId) shift += ' / 会場変更';
    row.append(title, path, el('span', 'change-shift', shift)); list.append(row);
  }
  $('changes').append(list);
}
function finishWorker() {
  if (state.worker) state.worker.terminate();
  state.worker = null; state.activeId = null; setRunning(false);
}
function reportWorkerError(message) {
  finishWorker(); state.proposal = null; renderProposal();
  setStatus('探索中にエラーが発生しました。元の予定は保持しています', 'error');
  showErrors($('error-notice'), [message], '探索を完了できませんでした');
}
function startSolve() {
  if (!state.problem) return;
  terminateWorker();
  state.proposal = null; renderProposal();
  showErrors($('error-notice'), []); showNotice('');
  const requestId = ++state.serial;
  state.activeId = requestId;
  setRunning(true); setStatus('条件を満たす、変更の少ない配置を探索しています', 'running');
  $('progress').textContent = '0 nodes';
  $('proposal-badge').textContent = '探索中';
  emptyProposal('組み直しを考えています。', 'いつでも探索を停止できます。元の予定は保持されています。', '↗');
  try {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    state.worker = worker;
    worker.addEventListener('message', (event) => {
      const message = event.data;
      if (worker !== state.worker || requestId !== state.activeId || message?.requestId !== requestId) return;
      if (message.type === 'progress') {
        $('progress').textContent = `${format(message.progress.nodes)} nodes`;
      } else if (message.type === 'error') {
        reportWorkerError(message.error || '探索の読み込みに失敗しました。');
      } else if (message.type === 'result') {
        const result = message.result;
        if (!result || !['optimal', 'feasible', 'infeasible', 'unknown'].includes(result.status)) return reportWorkerError('探索結果の状態が不正です。');
        if (result.assignments) {
          const checked = verifyAssignments(state.problem, result.assignments);
          if (!checked.ok) return reportWorkerError(`修復案の独立検証に失敗しました: ${checked.errors.join(' / ')}`);
        }
        finishWorker(); state.proposal = result; renderProposal();
        $('progress').textContent = `${format(result.nodes)} nodes`;
        const statusTexts = {
          optimal: '最適な修復案を確認しました。すべての条件を独立検証済みです',
          feasible: result.reason === 'cancelled' ? '探索を停止しました。有効な修復案はありますが、最適性は未証明です' : '探索上限に到達しました。有効な修復案はありますが、最適性は未証明です',
          infeasible: '現在の条件をすべて満たす配置がないことを確認しました',
          unknown: result.reason === 'cancelled' ? '探索を停止しました。有効な案は未発見で、結論は未確定です' : '探索上限に到達しました。有効な案は未発見で、結論は未確定です',
        };
        setStatus(statusTexts[result.status], result.assignments ? 'success' : result.status === 'infeasible' ? 'error' : 'idle');
      }
    });
    worker.addEventListener('error', (event) => {
      if (worker !== state.worker || requestId !== state.activeId) return;
      event.preventDefault(); reportWorkerError('探索用Workerを実行できませんでした。ページを再読み込みしてお試しください。');
    });
    worker.postMessage({ type: 'solve', requestId, problem: state.problem, nodeBudget: Number($('node-budget').value) });
  } catch (error) { reportWorkerError(error instanceof Error ? error.message : 'Workerを開始できませんでした。'); }
}
function downloadJSON(value, name) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function parseTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return ((hour < 24 && minute < 60) || (hour === 24 && minute === 0)) ? hour * 60 + minute : null;
}
$('solve').addEventListener('click', startSolve);
$('cancel').addEventListener('click', () => {
  if (!state.worker || state.activeId === null) return;
  state.worker.postMessage({ type: 'cancel', requestId: state.activeId });
  $('cancel').disabled = true; $('cancel').textContent = '停止しています…';
  setStatus('探索の停止を要求しました。見つかった案を検証しています', 'running');
});
$('export-baseline').addEventListener('click', () => {
  if (state.problem) downloadJSON(state.problem, 'agenda-original.json');
});
$('export-proposal').addEventListener('click', () => {
  if (!state.proposal?.assignments) return;
  const { assignments, objective, status, reason } = state.proposal;
  downloadJSON({ version: 1, problem: state.problem, proposal: { assignments, objective, status, reason } }, 'agenda-proposal-audit.json');
});
$('blackout-type').addEventListener('change', renderBlackoutTargets);
$('blackout-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const start = parseTime($('blackout-start').value), end = parseTime($('blackout-end').value);
  const error = $('blackout-error'); error.hidden = true;
  const report = (message) => { error.textContent = message; error.hidden = false; };
  if (start === null || end === null) return report('開始と終了を HH:MM で入力してください（00:00〜24:00）。');
  if (start >= end) return report('終了は開始より後の時刻にしてください。');
  if (start < state.problem.day.start || end > state.problem.day.end) return report(`開催時間（${minuteLabel(state.problem.day.start)}–${minuteLabel(state.problem.day.end)}）の範囲内で指定してください。`);
  if (!$('blackout-target').value) return report('登録された対象を選んでください。');
  const next = structuredClone(state.problem);
  let counter = 1;
  while (next.blackouts.some((item) => item.id === `block-${counter}`)) counter += 1;
  next.blackouts.push({ id: `block-${counter}`, type: $('blackout-type').value, targetId: $('blackout-target').value, start, end });
  const result = mutateProblem(next, '利用不可の時間帯を追加しました。修復案を再計算してください。');
  if (!result.ok) report(result.errors.join(' / '));
});
$('open-import').addEventListener('click', () => {
  importEpoch += 1; $('json-input').value = ''; $('json-file').value = '';
  showErrors($('import-errors'), []); $('import-dialog').showModal();
});
$('import-dialog').addEventListener('close', () => { importEpoch += 1; });
$('json-input').addEventListener('input', () => { importEpoch += 1; });
$('close-import').addEventListener('click', () => $('import-dialog').close());
$('import-cancel').addEventListener('click', () => $('import-dialog').close());
$('json-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  const epoch = ++importEpoch;
  if (!file) return;
  $('json-input').value = '';
  showErrors($('import-errors'), []);
  if (file.size > LIMITS.importBytes) return showErrors($('import-errors'), ['JSONファイルは100 KB以内にしてください。'], 'ファイルを読み込めません');
  try {
    const text = await file.text();
    if (epoch !== importEpoch || !$('import-dialog').open || event.target.files?.[0] !== file) return;
    $('json-input').value = text;
  } catch { if (epoch === importEpoch && $('import-dialog').open) showErrors($('import-errors'), ['ファイルを読み取れませんでした。JSONを貼り付ける方法も利用できます。']); }
});
$('import-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const checked = parseProblem($('json-input').value);
  if (!checked.ok) return showErrors($('import-errors'), checked.errors, '現在の予定は変更していません');
  applyProblem(checked.value, null, 'JSONの予定を読み込みました。元の配置と条件を確認して、探索を開始できます。');
  $('import-dialog').close(); $('project-title').scrollIntoView({ block: 'start', behavior: 'auto' });
});
const pageLifecycle = createPageLifecycle({
  isRunning: () => state.running,
  interrupt: () => {
    invalidateProposal('画面を離れたため、探索を中断しました。もう一度探索してください');
    renderProposal();
  },
  dispose: terminateWorker,
  restore: () => {
    setStatus('画面を離れたため、探索を中断しました。もう一度探索してください');
    showNotice('元の予定は保持しています。中断した探索を再開するには「修復案を探す」を押してください。');
    $('solve').focus({ preventScroll: true });
  },
});
window.addEventListener('pagehide', pageLifecycle.pagehide);
window.addEventListener('pageshow', pageLifecycle.pageshow);
const first = DEMOS.length ? validateProblem(DEMOS[0].problem) : { ok: false, errors: ['サンプルの予定がありません。'] };
if (first.ok) applyProblem(first.value, DEMOS[0].id);
else showErrors($('error-notice'), first.errors, '初期データを読み込めませんでした');
