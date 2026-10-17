# 경북과학대학교 전문대학 혁신지원사업 성과관리 시스템 (Netlify 배포판)

GitHub 저장소에 올리고 Netlify로 배포하는 버전입니다.
**접속 코드나 수정 PIN 없이** 주소를 아는 사람은 누구나 보고, 실적을 입력하고, AI 요약을 만들 수 있습니다.
입력한 값은 Netlify Blobs(Netlify 내장 저장소)에 저장되어 모든 사용자가 같은 화면을 봅니다.

## 폴더 구성

```
├─ netlify.toml                  배포 설정
├─ package.json                  함수용 패키지(@netlify/blobs)
├─ scripts/build.mjs             src/ → public/index.html 한 파일로 합치기
├─ src/                          화면 원본 (수정은 여기서)
│   ├─ index.html, app.css, app.js, report.js
│   └─ seed.json                 최초 데이터
├─ public/index.html             빌드 결과(배포되는 화면)
├─ public/logo.png               대학 로고(직접 추가)
└─ netlify/
    ├─ functions/                data · version · history · summary  (/api/...)
    ├─ edge-functions/           ai-summary  (Claude API 호출)
    └─ lib/                      저장소 공용 코드, 초기 데이터
```

## 1. GitHub에 올리기

1. GitHub에서 새 저장소를 만듭니다. 공개(Public)/비공개(Private) 모두 됩니다. 비공개를 권장합니다.
2. 이 폴더의 파일을 모두 올립니다.
   - 웹에서: 저장소 화면의 **Add file → Upload files**로 폴더 내용을 끌어다 놓고 Commit.
   - Git으로: `git init` → `git add .` → `git commit -m "init"` → `git remote add origin <주소>` → `git push -u origin main`
3. `.env` 파일이나 API 키를 저장소에 올리지 마세요.

## 2. Netlify에서 배포하기

1. https://app.netlify.com 에 GitHub 계정으로 로그인합니다.
2. **Add new site → Import an existing project → GitHub** 에서 저장소를 선택합니다.
3. 설정 화면은 `netlify.toml`이 자동으로 채웁니다. 그대로 **Deploy** 를 누르세요.
   - Build command: `node scripts/build.mjs`
   - Publish directory: `public`
4. 1~2분 뒤 `https://<사이트이름>.netlify.app` 주소가 생깁니다.
   **Site configuration → Change site name** 에서 추측하기 어려운 이름으로 바꾸는 것을 권장합니다.

Netlify Blobs는 별도 설정 없이 자동으로 켜집니다. 첫 접속 때 `src/seed.json` 내용으로 데이터가 만들어집니다.

## 3. AI 요약 켜기 (선택)

1. **Site configuration → Environment variables → Add a variable**
   - `ANTHROPIC_API_KEY` = Claude API 키 (console.anthropic.com 에서 발급)
   - `AI_MODEL` = 사용할 모델 (생략 시 `claude-sonnet-5-5`)
2. **Deploys → Trigger deploy → Deploy site** 로 다시 배포합니다.

키는 Netlify 서버에만 있고 브라우저로 전달되지 않습니다.
누구나 AI 요약을 만들 수 있으므로 **Anthropic 콘솔에서 월 사용 한도(spend limit)를 꼭 설정**하세요.

## 4. 사용

- 화면 기능은 로컬판과 같습니다(2차/1차년도 전환, 도넛·색상 구간, 실적 입력, 자료 점검, 일정, 다크 모드, CSV·인쇄).
- **현재값 바로 수정**: 2차년도 화면의 세부지표 표에서 '현재값' 칸(연필 표시)을 누르면 그 자리에서 세부운영지수, 상태, 비고를 고칠 수 있습니다. 입력하는 동안 합계·유지율·진척률이 바로 계산되고, Enter로 저장, Esc로 취소합니다.
- 여러 지표를 한꺼번에 입력할 때는 우측 상단 **실적 입력**을 쓰세요.
- 다른 사람이 저장하면 30초 안에 화면이 갱신됩니다(탭이 보이는 동안).
- 두 사람이 동시에 저장하면 나중 사람에게 최신 내용을 불러온 뒤 다시 입력하라는 안내가 나옵니다.
- **변경 이력**: 저장할 때마다 직전 버전이 보관됩니다(최근 100개). 잘못 입력했거나 누군가 값을 지웠다면
  화면 상단 **변경 이력**에서 원하는 버전을 골라 **복원**하세요. 복원해도 현재 버전은 이력에 남습니다.
- **JSON 내보내기**로 정기 백업을 받아 두세요. 로컬판이나 HTML판에서 쓰던 데이터는 **JSON 불러오기**로 옮길 수 있습니다.

## 5. 대학 로고 넣기

화면 좌측 상단은 `public/logo.png` 파일을 대학 로고로 표시합니다. 파일이 없으면 기본 아이콘이 나옵니다.

1. 경북과학대학교 홈페이지 → 대학소개 → 경과대 상징 → **경과대 UI** 에서 심볼마크 또는 시그니처(가로형) 이미지를 내려받습니다.
2. 파일 이름을 `logo.png` 로 바꿔 저장소의 `public/` 폴더에 올립니다(PNG, 배경 투명 또는 흰색, 가로 360px 이상 권장).
3. GitHub에 커밋하면 자동으로 다시 배포됩니다.

로고는 흰 바탕 상자 안에 높이 36px로 표시됩니다. 대학 UI 규정(최소 크기, 여백, 색상)에 맞는 파일을 사용하세요.

## 6. 화면 수정 후 다시 배포

`src/` 파일을 고쳐 GitHub에 올리면 Netlify가 자동으로 빌드·배포합니다.
`public/index.html`은 빌드 때마다 새로 만들어지므로 직접 고치지 마세요.
내 PC에서 미리 합쳐 보려면 `node scripts/build.mjs` 를 실행합니다(Node.js 18 이상).

초기 데이터(`src/seed.json`)를 바꿔도 **이미 저장된 데이터는 바뀌지 않습니다.** 운영 중에는 화면의 실적 입력이나 JSON 불러오기를 쓰세요.

## 7. 공개 접속 버전에서 알아 둘 점

- 로그인이 없으므로 **주소를 아는 사람은 누구나 값을 바꿀 수 있습니다.** 주소는 내부에만 공유하세요.
  검색엔진 노출은 막아 두었습니다(noindex).
- 공개 인터넷에 올라가므로 초기 데이터에서 **담당자 개인 이름은 뺐습니다**(부서명만 표시).
  필요하면 실적 입력의 비고란에 넣을 수 있지만, 외부에 공개되어도 괜찮은 정보만 넣으세요.
- 나중에 접근을 제한하고 싶다면 Netlify의 사이트 비밀번호 보호(유료 요금제) 기능을 켜거나,
  편집 PIN이 있는 로컬판을 함께 쓰는 방법이 있습니다.
- Netlify 무료 요금제의 함수 호출 한도 안에서 동작하도록 갱신 확인은 30초 간격, 화면이 보일 때만 합니다.
  사용자가 많아 한도에 가까워지면 `src/app.js`의 `POLL_MS` 값을 늘리세요.
