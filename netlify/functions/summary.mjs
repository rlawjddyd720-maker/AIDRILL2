// GET  /api/summary  AI 사용 가능 여부와 저장된 요약
// POST /api/summary  { view, version, editor, text, model }  생성된 요약 저장(모든 사용자 공유)
import { store, json, nowKst } from '../lib/store.mjs';

export default async (req) => {
  const s = store();
  const cached = (await s.get('summaries', { type: 'json' })) || {};
  if (req.method === 'GET') {
    return json(200, {
      ai: Boolean(process.env.ANTHROPIC_API_KEY),
      model: process.env.AI_MODEL || 'claude-sonnet-5-5',
      edge: true,
      cached,
    });
  }
  if (req.method === 'POST') {
    let p;
    try { p = await req.json(); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
    if (!p || !['y1', 'y2'].includes(p.view) || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 20000) {
      return json(400, { error: '요약 형식이 올바르지 않습니다.' });
    }
    const entry = {
      text: p.text,
      version: p.version,
      generatedAt: nowKst(),
      by: String(p.editor || '이름 없음').slice(0, 40),
      model: String(p.model || '').slice(0, 60),
    };
    cached[p.view] = entry;
    await s.setJSON('summaries', cached);
    return json(200, entry);
  }
  return json(405, { error: '허용되지 않는 요청입니다.' });
};

export const config = { path: '/api/summary' };
