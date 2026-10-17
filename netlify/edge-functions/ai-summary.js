// POST /api/ai-summary { input }  →  { text, model }
// Claude API 호출은 응답이 길어 일반 함수의 실행 시간 제한(10초)에 걸릴 수 있어 Edge Function에서 처리합니다.
// API 키는 Netlify 환경변수 ANTHROPIC_API_KEY에만 두며, 브라우저로 전달하지 않습니다.

const SYSTEM_PROMPT = `당신은 전문대학 혁신지원사업 AI 사업단의 성과관리 담당자입니다.
사업단장에게 올릴 자율성과지표 현황 요약 보고서를 한국어로 작성합니다.

원칙
- 제공된 JSON 데이터에 있는 수치만 사용합니다. 계산하거나 추정한 값을 새로 만들지 않습니다.
- value가 null인 항목은 '미입력', flag가 있는 항목은 그 상태(근거 확인, 계획 포함 등)를 반드시 밝힙니다.
- 진척률(rate)은 2차년도 목표 대비 비율입니다. 누적형(type=count) 지표는 집계기간 경과율(paceRatio)과 비교해 해석하고,
  점수·비율형(type=level) 지표는 목표 대비로만 해석합니다.
- 지수는 3차년도 목표를 분모로 하므로 집계 중간에는 낮게 나온다는 점을 필요할 때 짚습니다.
- 단장이 1~2분 안에 읽을 수 있게 간결하게 씁니다. 과장이나 미사여구를 쓰지 않습니다.

형식 (마크다운, 아래 제목을 그대로 사용)
## 종합 판단
2~3문장.
## 지수별 현황
지수마다 한 줄 불릿. 진척률(또는 달성도)과 핵심 원인.
## 주의가 필요한 지표
불릿. 이유와 함께.
## 권고 조치
불릿. 각 항목 앞에 **담당 부서**를 굵게 표시.
## 확인이 필요한 자료
불릿. 미입력·근거 확인·계획 포함 값과 자료 점검 미해결 항목.`;

const reply = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default async (request) => {
  if (request.method !== 'POST') return reply(405, { error: '허용되지 않는 요청입니다.' });
  const key = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!key) return reply(400, { error: 'AI 요약을 쓰려면 Netlify 환경변수 ANTHROPIC_API_KEY를 설정하고 다시 배포하세요.' });
  const model = Netlify.env.get('AI_MODEL') || 'claude-sonnet-5-5';

  const raw = await request.text();
  if (!raw || raw.length > 200000) return reply(400, { error: '요약 요청이 비어 있거나 너무 큽니다.' });
  let input;
  try { input = JSON.parse(raw).input; } catch { input = null; }
  if (!input || typeof input !== 'object') return reply(400, { error: '요약 요청 형식이 올바르지 않습니다.' });

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: '다음은 성과관리 시스템의 현재 데이터(JSON)입니다. 형식에 맞춰 요약 보고서를 작성해 주세요.\n\n' + JSON.stringify(input) }],
      }),
    });
  } catch (e) {
    return reply(502, { error: 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도하세요.' });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (j.error && j.error.message) || '';
    return reply(502, { error: `AI 서비스 오류(${res.status}) ${m}`.trim() });
  }
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) return reply(502, { error: 'AI가 빈 응답을 보냈습니다. 다시 시도해 주세요.' });
  return reply(200, { text, model });
};

export const config = { path: '/api/ai-summary' };
