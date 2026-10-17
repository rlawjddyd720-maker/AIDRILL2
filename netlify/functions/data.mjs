// GET  /api/data  현재 데이터
// PUT  /api/data  { data, baseVersion, editor }  저장 (버전이 다르면 409)
import { store, json, readData, commit } from '../lib/store.mjs';

const MAX = 2 * 1024 * 1024;

export default async (req) => {
  const s = store();
  if (req.method === 'GET') {
    const d = await readData(s);
    return json(200, { ...d, _auth: false });
  }
  if (req.method === 'PUT') {
    const raw = await req.text();
    if (!raw || raw.length > MAX) return json(400, { error: '저장할 내용이 비어 있거나 너무 큽니다.' });
    let p;
    try { p = JSON.parse(raw); } catch { return json(400, { error: '저장 형식이 올바르지 않습니다.' }); }
    const next = p && p.data;
    const base = Number(p && p.baseVersion);
    if (!next || !Array.isArray(next.indices) || !next.meta || !Number.isFinite(base)) {
      return json(400, { error: '저장 형식이 올바르지 않습니다.' });
    }
    const current = await readData(s);
    if (current.version !== base) {
      return json(409, { error: '다른 사용자가 먼저 저장했습니다. 최신 내용을 불러왔으니 다시 입력해 주세요.', current });
    }
    const saved = await commit(s, current, next, p.editor);
    return json(200, { ...saved, _auth: false });
  }
  return json(405, { error: '허용되지 않는 요청입니다.' });
};

export const config = { path: '/api/data' };
