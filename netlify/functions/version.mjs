// GET /api/version  다른 사용자의 저장 여부 확인용(가벼운 응답)
import { json, readData } from '../lib/store.mjs';

export default async () => {
  const d = await readData();
  return json(200, { version: d.version, updatedAt: d.updatedAt, updatedBy: d.updatedBy });
};

export const config = { path: '/api/version' };
