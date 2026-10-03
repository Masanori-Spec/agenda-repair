import { solve } from './solver.js';
import { verifyAssignments } from './verify.js';

let activeRequest = null;
self.addEventListener('message', async (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'cancel') {
    if (activeRequest?.id === message.requestId) activeRequest.cancelled = true;
    return;
  }
  if (message.type !== 'solve') return;
  if (activeRequest) activeRequest.cancelled = true;
  const request = { id: message.requestId, cancelled: false };
  activeRequest = request;
  try {
    const result = await solve(message.problem, {
      nodeBudget: message.nodeBudget,
      shouldCancel: () => request.cancelled,
      onProgress: (progress) => {
        if (activeRequest === request) self.postMessage({ type: 'progress', requestId: request.id, progress });
      },
    });
    if (activeRequest !== request) return;
    if (result.assignments) {
      const verified = verifyAssignments(message.problem, result.assignments);
      if (!verified.ok) throw new Error(`修復案の独立検証に失敗しました: ${verified.errors.join(' / ')}`);
      if (!['optimal', 'feasible'].includes(result.status)) throw new Error('探索状態と配置の整合性を確認できませんでした。');
    } else if (['optimal', 'feasible'].includes(result.status)) {
      throw new Error('有効とされた結果に配置がありません。');
    }
    self.postMessage({ type: 'result', requestId: request.id, result });
  } catch (error) {
    if (activeRequest === request) self.postMessage({ type: 'error', requestId: request.id, error: error instanceof Error ? error.message : '探索中にエラーが発生しました。' });
  } finally {
    if (activeRequest === request) activeRequest = null;
  }
});
