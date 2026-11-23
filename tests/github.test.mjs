// 실행: node --test tests/github.test.mjs
// GitHub Contents API 호출부(ghGet/ghPut)를 가짜 fetch로 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../marathon2027_dashboard.html', import.meta.url), 'utf8');
const cut = (from, to) => {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `구간을 찾을 수 없음: ${from}`);
  return html.slice(a, b);
};
const code =
  cut("const KEY='marathon2027_v2'", '// ---------- 저장 ----------') +
  cut('// ---------- 한글 CSV 저장/불러오기', '// 아티팩트 downloads') +
  cut('// ---------- GitHub 동기화 (API)', '// ---------- GitHub 동기화 (화면)') +
  '\n;({b64enc,b64dec,ghGet,ghPut,toCSV,fromCSV})';
const ctx = vm.runInNewContext(code, { TextEncoder, TextDecoder, btoa, atob, Uint8Array, fetch: () => { throw new Error('실제 네트워크 사용 금지'); } });
const plain = v => JSON.parse(JSON.stringify(v));

const cfg = { repo: 'me/DATA', path: 'training_log.csv', branch: 'main', token: 'test-token' };
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('base64 UTF-8 한글 왕복', () => {
  const s = '구분,날짜\r\n훈련,2026-11-24 "메모"';
  assert.equal(ctx.b64dec(ctx.b64enc(s)), s);
  // TextDecoder는 선두 BOM을 제거함 (fromCSV는 BOM 유무와 무관)
  assert.equal(ctx.b64dec(ctx.b64enc('﻿' + s)), s);
  assert.equal(ctx.b64enc('가'), Buffer.from('가').toString('base64'));
  assert.equal(ctx.b64dec('6rCA\n'), '가'); // GitHub 응답의 줄바꿈 포함 base64
});

test('ghGet: 파일 내용과 sha 반환, 인증 헤더 포함', async () => {
  let call;
  const f = async (url, opt) => { call = { url, opt }; return res(200, { content: Buffer.from('구분,날짜\n').toString('base64'), sha: 'abc' }); };
  const r = plain(await ctx.ghGet(cfg, f));
  assert.deepEqual(r, { text: '구분,날짜\n', sha: 'abc' });
  assert.equal(call.url, 'https://api.github.com/repos/me/DATA/contents/training_log.csv?ref=main');
  assert.equal(call.opt.headers.Authorization, 'Bearer test-token');
});

test('ghGet: 404는 파일 없음(null), 401은 한글 오류', async () => {
  assert.equal(await ctx.ghGet(cfg, async () => res(404, {})), null);
  await assert.rejects(ctx.ghGet(cfg, async () => res(401, {})), /토큰/);
});

test('ghPut: CSV를 base64로 커밋하고 새 sha 반환', async () => {
  let body;
  const f = async (url, opt) => { body = JSON.parse(opt.body); assert.equal(opt.method, 'PUT'); return res(200, { content: { sha: 'new' } }); };
  const st = { logs: [{ id: 1, date: '2026-11-24', type: 'easy', km: 8, mainKm: 8, sec: 2730, hr: 145, rpe: 4, note: '좋음' }], races: [] };
  const r = plain(await ctx.ghPut(cfg, ctx.toCSV(st), 'old', f));
  assert.deepEqual(r, { sha: 'new' });
  assert.equal(body.sha, 'old');
  assert.equal(body.branch, 'main');
  const back = plain(ctx.fromCSV(Buffer.from(body.content, 'base64').toString('utf8')));
  assert.equal(back.logs[0].note, '좋음');
});

test('ghPut: 새 파일이면 sha 생략, 충돌(409/422)은 conflict', async () => {
  let body;
  await ctx.ghPut(cfg, 'x', null, async (u, o) => { body = JSON.parse(o.body); return res(201, { content: { sha: 's' } }); });
  assert.ok(!('sha' in body));
  assert.deepEqual(plain(await ctx.ghPut(cfg, 'x', 'old', async () => res(409, {}))), { conflict: true });
  assert.deepEqual(plain(await ctx.ghPut(cfg, 'x', null, async () => res(422, {}))), { conflict: true });
  await assert.rejects(ctx.ghPut(cfg, 'x', 'old', async () => res(403, {})), /권한/);
});
