// GET  /api/history            저장 이력(최근 100개)
// POST /api/history {version}  해당 버전으로 복원(새 버전으로 저장)
import { store, json, readData, readHistory, readBackup, commit } from '../lib/store.mjs';

export default async (req) => {
  const s = store();
  if (req.method === 'GET') {
    const [history, current] = await Promise.all([readHistory(s), readData(s)]);
    return json(200, { current: { version: current.version, updatedAt: current.updatedAt, updatedBy: current.updatedBy }, history });
  }
  if (req.method === 'POST') {
    let p;
    try { p = await req.json(); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
    const v = Number(p && p.version);
    const backup = Number.isFinite(v) ? await readBackup(v, s) : null;
    if (!backup) return json(404, { error: '해당 버전을 찾지 못했습니다.' });
    const current = await readData(s);
    const editor = String((p && p.editor) || '이름 없음').slice(0, 30) + ` (v${v} 복원)`;
    const saved = await commit(s, current, backup, editor);
    return json(200, { ...saved, _auth: false });
  }
  return json(405, { error: '허용되지 않는 요청입니다.' });
};

export const config = { path: '/api/history' };
