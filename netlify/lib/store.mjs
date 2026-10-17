// 공용: Netlify Blobs 저장소 접근, 응답 도우미, 저장(백업·이력 포함)
import { getStore } from '@netlify/blobs';
import seed from './seed.mjs';

const KEEP = 100;

export const store = () => getStore({ name: 'pms', consistency: 'strong' });

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// 한국 시간 ISO 문자열 (예: 2026-10-16T09:30:00+09:00)
export function nowKst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 19) + '+09:00';
}

export async function readData(s = store()) {
  let d = await s.get('data', { type: 'json' });
  if (!d) {
    d = JSON.parse(JSON.stringify(seed));
    await s.setJSON('data', d);
  }
  return d;
}

const backupKey = (v) => 'backups/' + String(v).padStart(8, '0');

export async function readHistory(s = store()) {
  return (await s.get('history', { type: 'json' })) || [];
}

export async function readBackup(version, s = store()) {
  return s.get(backupKey(version), { type: 'json' });
}

// 현재본을 백업하고 새 버전으로 저장
export async function commit(s, current, next, editor) {
  await s.setJSON(backupKey(current.version), current);
  const history = await readHistory(s);
  const exists = history.some((h) => h.version === current.version);
  if (!exists) history.unshift({ version: current.version, updatedAt: current.updatedAt, updatedBy: current.updatedBy });
  const removed = history.splice(KEEP);
  await Promise.all(removed.map((h) => s.delete(backupKey(h.version))));
  await s.setJSON('history', history);

  delete next._auth;
  next.version = current.version + 1;
  next.updatedAt = nowKst();
  next.updatedBy = String(editor || '이름 없음').slice(0, 40);
  await s.setJSON('data', next);
  return next;
}
