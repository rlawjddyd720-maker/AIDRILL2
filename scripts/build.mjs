// src/의 화면 파일을 하나로 합쳐 public/index.html을 만듭니다(외부 패키지 없음).
// 서버가 없을 때를 대비해 초기 데이터도 함께 넣습니다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let html = read('src/index.html');
const css = read('src/app.css');
const app = read('src/app.js');
const report = read('src/report.js');
const seed = JSON.stringify(JSON.parse(read('src/seed.json'))).replace(/<\//g, '<\\/');

for (const [name, src] of [['app.js', app], ['report.js', report]]) {
  if (/<\/script/i.test(src)) throw new Error(name + '에 </script 문자열이 있어 합칠 수 없습니다.');
}
html = html.replace('<link rel="stylesheet" href="app.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script src="app.js"></script>\n<script src="report.js"></script>',
  () => `<script>\nwindow.PMS_SEED = ${seed};\n</script>\n<script>\n${app}\n</script>\n<script>\n${report}\n</script>`);
if (html.includes('href="app.css"') || html.includes('src="app.js"')) throw new Error('합치기에 실패했습니다.');

mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/index.html', import.meta.url), html);
console.log('public/index.html 생성 완료 (' + Math.round(html.length / 1024) + ' KB)');
