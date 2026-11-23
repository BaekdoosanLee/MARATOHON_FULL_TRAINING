// 브라우저 E2E 검증 (Headless Chrome + DevTools Protocol, 의존성 없음)
// 실행: node tests/e2e.chrome.mjs   (CHROME 환경변수로 실행 파일 경로 지정 가능)
// GitHub API는 페이지 안의 가짜 fetch로 대체 — 실제 네트워크/토큰 사용 안 함
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
if (!CHROME) { console.error('Chrome을 찾을 수 없습니다 (CHROME 환경변수 지정)'); process.exit(2); }

const PAGE = pathToFileURL(resolve(fileURLToPath(new URL('../marathon2027_dashboard.html', import.meta.url)))).href;
const PORT = 9333 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), 'mt-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 페이지 스크립트보다 먼저 실행: confirm 자동 승인, 다운로드 가로채기, GitHub API 가짜 서버
const STUB = String.raw`(()=>{
  const K='__mockgh';
  const load=()=>JSON.parse(localStorage.getItem(K)||'{"file":null,"commits":0}');
  const store=s=>localStorage.setItem(K,JSON.stringify(s));
  window.__gh={load,store};
  const realFetch=window.fetch.bind(window);
  window.fetch=async(url,opt={})=>{
    url=String(url);
    if(!url.startsWith('https://api.github.com/'))return realFetch(url,opt);
    const R=(st,b)=>new Response(JSON.stringify(b),{status:st,headers:{'Content-Type':'application/json'}});
    if((opt.headers||{}).Authorization!=='Bearer test-token')return R(401,{});
    if(!url.startsWith('https://api.github.com/repos/me/DATA/contents/training_log.csv'))return R(404,{});
    const s=load();
    if((opt.method||'GET')==='GET')return s.file?R(200,{content:s.file.content.replace(/(.{60})/g,'$1\n'),sha:s.file.sha}):R(404,{});
    const b=JSON.parse(opt.body);
    if(s.file?b.sha!==s.file.sha:!!b.sha)return R(409,{});
    s.commits++;s.file={content:b.content,sha:'sha'+s.commits};s.message=b.message;store(s);
    return R(s.commits===1?201:200,{content:{sha:s.file.sha}});
  };
  window.confirm=()=>true;
  window.__dl=[];
  const oc=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(!this.download)return oc.call(this);
    const a=this;
    window.__dl.push(realFetch(a.href).then(r=>r.arrayBuffer()).then(b=>{const u=new Uint8Array(b);
      return{name:a.download,bom:u[0]===0xEF&&u[1]===0xBB&&u[2]===0xBF,text:new TextDecoder('utf-8',{ignoreBOM:true}).decode(u)}}));
  };
})();`;

let ws, seq = 0;
const pending = new Map(), errors = [];
let loadWaiter = null;
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function ev(body) {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${body}})()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const loaded = () => new Promise(r => { loadWaiter = r; });

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['✔', name]); }
  catch (e) { results.push(['✖', name, e.message]); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: 기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(200); }
  }
  ok(target, 'Chrome DevTools 연결 실패');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === 'Page.loadEventFired' && loadWaiter) { loadWaiter(); loadWaiter = null; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  let l = loaded(); await send('Page.navigate', { url: PAGE }); await l;

  await check('첫 화면 렌더링 (D-day, KPI, 계획표)', async () => {
    const r = await ev(`return {dday:$('dday').textContent,kpis:$('kpis').children.length,plan:$('plan').querySelectorAll('tr').length,btn:$('saveBtn').textContent}`);
    ok(/^D-\d+/.test(r.dday), 'D-day 없음'); ok(r.kpis >= 4, 'KPI 카드 부족'); ok(r.plan >= 14, '주간 계획표 부족');
    eq(r.btn, '💾 CSV 파일로 저장', '저장 버튼 문구');
  });

  await check('훈련 기록 입력 (이지런)', async () => {
    const r = await ev(`const f=$('logForm');f.date.value='2026-11-24';f.type.value='easy';f.type.dispatchEvent(new Event('change',{bubbles:true}));
      f.km.value='8';f.time.value='45:30';f.hr.value='145';f.rpe.value='4';f.note.value='가볍게, "컨디션" 좋음';f.requestSubmit();
      return {n:S.logs.length,l:S.logs[0],msg:$('formMsg').textContent}`);
    eq(r.n, 1, '기록 수'); eq([r.l.type, r.l.km, r.l.sec, r.l.hr], ['easy', 8, 2730, 145], '저장 값');
  });

  await check('훈련 기록 입력 (템포 + 워밍업/쿨다운)', async () => {
    const r = await ev(`const f=$('logForm');f.date.value='2026-11-26';f.type.value='tempo';f.type.dispatchEvent(new Event('change',{bubbles:true}));
      f.km.value='6';f.time.value='28:30';f.hr.value='165';f.wuKm.value='2';f.wuMin.value='12';f.cdKm.value='2';f.cdMin.value='12';f.reps.value='30분 지속';f.target.value='4:40';f.requestSubmit();
      return S.logs[1]`);
    eq([r.type, r.km, r.mainKm, r.wu.km, r.cd.km, r.reps, r.target], ['tempo', 10, 6, 2, 2, '30분 지속', '4:40'], '저장 값');
  });

  await check('대회 기록 입력', async () => {
    const r = await ev(`const f=$('raceForm');f.date.value='2026-12-14';f.name.value='테스트 10K';f.km.value='10';f.time.value='0:42:10';f.requestSubmit();return S.races`);
    eq(r.length, 2, '대회 수'); eq([r[1].name, r[1].sec], ['테스트 10K', 2530], '대회 값');
  });

  let saved;
  await check('CSV 파일로 저장 (파일명·BOM·한글 머리글·내용)', async () => {
    saved = await ev(`$('saveBtn').click();await new Promise(r=>setTimeout(r,300));return await window.__dl[0]`);
    ok(/^marathon2027_\d{4}-\d{2}-\d{2}\.csv$/.test(saved.name), `파일명 ${saved.name}`);
    ok(saved.bom, 'UTF-8 BOM 없음 (엑셀 한글 깨짐)');
    const lines = saved.text.replace(/^\uFEFF/, '').split('\r\n');
    ok(lines[0].startsWith('구분,날짜,종류,총거리(km)'), '한글 머리글 아님');
    ok(lines.some(x => x.startsWith('훈련,2026-11-24,이지런,8,8,0:45:30,145,4')), '이지런 행 없음');
    ok(lines.some(x => x.startsWith('훈련,2026-11-26,템포,10,6,0:28:30')), '템포 행 없음');
    ok(lines.some(x => x.startsWith('대회기록,2026-12-14,대회,10,,0:42:10')), '대회 행 없음');
    ok(saved.text.includes('"가볍게, ""컨디션"" 좋음"'), '메모 따옴표 처리');
  });

  await check('초기화', async () => {
    const r = await ev(`$('reset').click();return [S.logs.length,S.races.length]`);
    eq(r, [0, 0], '초기화 후 건수');
  });

  const importFile = (text, name) => ev(`const f=new File([${JSON.stringify(text)}],${JSON.stringify(name)});const dt=new DataTransfer();dt.items.add(f);
      const i=$('imp');i.files=dt.files;i.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,300));
      return {logs:S.logs,races:S.races,msg:$('msg').textContent,cls:$('msg').className,val:i.value}`);

  await check('CSV 파일 불러오기 (저장 파일 왕복 복원)', async () => {
    const r = await importFile(saved.text, saved.name);
    eq([r.logs.length, r.races.length], [2, 2], '불러온 건수');
    eq(r.logs[0].note, '가볍게, "컨디션" 좋음', '메모 복원');
    eq([r.logs[1].type, r.logs[1].wu.km, r.logs[1].target], ['tempo', 2, '4:40'], '템포 상세 복원');
    eq(r.val, '', '파일 입력 초기화');
    ok(r.cls.includes('good'), r.msg);
  });

  await check('구버전 JSON 백업 불러오기 호환', async () => {
    const r = await importFile(JSON.stringify({ logs: [{ id: 1, date: '2026-11-30', type: 'long', km: 15, sec: 5400 }], races: [] }), 'old.json');
    eq([r.logs.length, r.logs[0].type], [1, 'long'], 'JSON 불러오기');
  });

  await check('잘못된 CSV는 거부하고 기존 데이터 유지', async () => {
    const r = await importFile('구분,날짜\n훈련,2026/12/01\n', 'bad.csv');
    eq(r.logs.length, 1, '기존 데이터 유지'); ok(r.cls.includes('bad') && r.msg.includes('2행'), r.msg);
  });

  await check('GitHub 연결: 원격 파일 없음 → 현재 기록 최초 커밋', async () => {
    const r = await ev(`const f=$('ghForm');f.repo.value='https://github.com/me/DATA';f.token.value='test-token';f.requestSubmit();
      await new Promise(r=>setTimeout(r,500));const s=__gh.load();
      return {st:$('ghState').textContent,commits:s.commits,csv:fromCSV(b64dec(s.file.content)),tokenField:f.token.value,repo:JSON.parse(localStorage.getItem('marathon2027_gh')).repo}`);
    ok(r.st.startsWith('✔'), r.st); eq(r.commits, 1, '커밋 수'); eq(r.csv.logs.length, 1, '원격 기록 수');
    eq(r.repo, 'me/DATA', 'URL 형태 저장소 정규화'); eq(r.tokenField, '', '토큰 입력칸 비움');
  });

  await check('기록 추가 시 GitHub 자동 커밋 (디바운스)', async () => {
    const r = await ev(`const f=$('logForm');f.date.value='2026-12-01';f.type.value='easy';f.type.dispatchEvent(new Event('change',{bubbles:true}));
      f.km.value='10';f.time.value='55:00';f.requestSubmit();
      const mid=$('ghState').textContent;await new Promise(r=>setTimeout(r,2200));const s=__gh.load();
      return {mid,st:$('ghState').textContent,commits:s.commits,n:fromCSV(b64dec(s.file.content)).logs.length,msg:s.message}`);
    ok(r.mid.includes('대기'), `대기 상태 표시 없음: ${r.mid}`); ok(r.st.startsWith('✔'), r.st);
    eq([r.commits, r.n], [2, 2], '커밋 수/원격 기록 수'); ok(r.msg.startsWith('훈련 기록 업데이트'), r.msg);
  });

  await check('기록 삭제 시 GitHub 자동 커밋', async () => {
    const r = await ev(`delLog(S.logs[1].id);await new Promise(r=>setTimeout(r,2200));const s=__gh.load();return [s.commits,fromCSV(b64dec(s.file.content)).logs.length]`);
    eq(r, [3, 1], '커밋 수/원격 기록 수');
  });

  await check('다른 기기 변경 → 저장 시 충돌 안내, 데이터 보존', async () => {
    const r = await ev(`const s=__gh.load();const d=fromCSV(b64dec(s.file.content));d.logs.push({id:9,date:'2026-12-02',type:'easy',km:5,mainKm:5,sec:1800,hr:0,rpe:0,note:'폰에서 입력'});
      s.commits++;s.file={content:b64enc(toCSV(d)),sha:'remote'};__gh.store(s);
      const f=$('logForm');f.date.value='2026-12-03';f.type.value='easy';f.type.dispatchEvent(new Event('change',{bubbles:true}));f.km.value='7';f.time.value='40:00';f.requestSubmit();
      await new Promise(r=>setTimeout(r,2200));return {st:$('ghState').textContent,sha:__gh.load().file.sha,local:S.logs.length}`);
    ok(r.st.startsWith('⚠'), r.st); eq(r.sha, 'remote', '원격 파일 보존'); eq(r.local, 2, '로컬 기록 보존');
  });

  await check('GitHub에서 불러오기 (원격 기록으로 대체)', async () => {
    const r = await ev(`$('ghPullBtn').click();await new Promise(r=>setTimeout(r,500));return {st:$('ghState').textContent,notes:S.logs.map(l=>l.note)}`);
    ok(r.st.startsWith('✔'), r.st); ok(r.notes.includes('폰에서 입력'), '원격 기록 반영 안 됨');
  });

  await check('GitHub에 저장(덮어쓰기)', async () => {
    const r = await ev(`S.logs.push({id:77,date:'2026-12-04',type:'easy',km:3,mainKm:3,sec:1200,hr:0,rpe:0,note:'덮어쓰기'});save(false);
      $('ghPushBtn').click();await new Promise(r=>setTimeout(r,500));const s=__gh.load();
      return {st:$('ghState').textContent,notes:fromCSV(b64dec(s.file.content)).logs.map(l=>l.note)}`);
    ok(r.st.startsWith('✔'), r.st); ok(r.notes.includes('덮어쓰기'), '덮어쓰기 반영 안 됨');
  });

  await check('새로고침 시 GitHub 최신 기록 자동 불러오기', async () => {
    await ev(`const s=__gh.load();const d=fromCSV(b64dec(s.file.content));d.logs.push({id:88,date:'2026-12-05',type:'long',km:18,mainKm:18,sec:6600,hr:0,rpe:0,note:'새로고침 확인'});
      s.commits++;s.file={content:b64enc(toCSV(d)),sha:'remote2'};__gh.store(s);`);
    l = loaded(); await send('Page.reload'); await l; await sleep(700);
    const r = await ev(`return {st:$('ghState').textContent,notes:S.logs.map(l=>l.note),ph:$('ghForm').token.placeholder,repo:$('ghForm').repo.value}`);
    ok(r.st.startsWith('✔'), r.st); ok(r.notes.includes('새로고침 확인'), '최신 기록 미반영');
    eq([r.repo, r.ph], ['me/DATA', '저장됨 (변경 시에만 입력)'], '설정 유지');
  });

  await check('저장 실패(토큰 오류) 후 새로고침 시 미저장 변경 재전송', async () => {
    const r1 = await ev(`const g=JSON.parse(localStorage.getItem('marathon2027_gh'));g.token='bad';localStorage.setItem('marathon2027_gh',JSON.stringify(g));gh.token='bad';
      S.logs.push({id:99,date:'2026-12-06',type:'easy',km:4,mainKm:4,sec:1500,hr:0,rpe:0,note:'재전송'});save();
      await new Promise(r=>setTimeout(r,2200));return {st:$('ghState').textContent,dirty:JSON.parse(localStorage.getItem('marathon2027_gh')).dirty}`);
    ok(r1.st.includes('토큰'), r1.st); eq(r1.dirty, true, 'dirty 표시');
    await ev(`const g=JSON.parse(localStorage.getItem('marathon2027_gh'));g.token='test-token';localStorage.setItem('marathon2027_gh',JSON.stringify(g));`);
    l = loaded(); await send('Page.reload'); await l; await sleep(700);
    const r2 = await ev(`const s=__gh.load();return {st:$('ghState').textContent,notes:fromCSV(b64dec(s.file.content)).logs.map(l=>l.note)}`);
    ok(r2.st.startsWith('✔'), r2.st); ok(r2.notes.includes('재전송'), '미저장 변경 재전송 안 됨');
  });

  await check('GitHub 연결 해제 (토큰 삭제)', async () => {
    const r = await ev(`$('ghOff').click();return {st:$('ghState').textContent,cfg:localStorage.getItem('marathon2027_gh')}`);
    eq([r.st, r.cfg], ['연결 안 됨', null], '해제 상태');
  });

  await check('브라우저 콘솔 오류 없음', async () => { eq(errors, [], '콘솔 오류'); });
} catch (e) {
  results.push(['✖', '실행 오류', e.message]);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { rmSync(prof, { recursive: true, force: true }); } catch {}
}

for (const [m, n, e] of results) console.log(`${m} ${n}${e ? `\n    → ${e}` : ''}`);
const fail = results.filter(r => r[0] === '✖').length;
console.log(`\n통과 ${results.length - fail} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
