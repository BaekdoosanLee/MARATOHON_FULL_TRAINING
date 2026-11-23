// 실행: node --test tests/
// 대시보드 HTML에서 순수 함수 구간만 잘라 vm에서 평가 후 CSV 저장/불러오기 왕복 검증
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
  '\n;({toCSV,fromCSV,parseCSV,CSV_COLS})';
const ctx = vm.runInNewContext(code, {});
const plain = v => JSON.parse(JSON.stringify(v)); // vm 영역 객체를 일반 객체로
const toCSV = ctx.toCSV, CSV_COLS = ctx.CSV_COLS;
const fromCSV = t => plain(ctx.fromCSV(t)), parseCSV = t => plain(ctx.parseCSV(t));

const sample = {
  logs: [
    { id: 1, date: '2026-11-24', type: 'easy', km: 8, mainKm: 8, sec: 2730, hr: 145, rpe: 4, note: '가볍게, "컨디션" 좋음' },
    { id: 2, date: '2026-11-25', type: 'hill', km: 10.5, mainKm: 4, sec: 1500, hr: 172, rpe: 8, note: '줄바꿈\n메모',
      wu: { km: 3, min: 18, hr: 140 }, cd: { km: 3.5, min: 20, hr: 138 }, reps: '60초×6, 회복 90초', target: '4:15' },
    { id: 3, date: '2026-11-26', type: 'rest', km: 0, mainKm: 0, sec: 0, hr: 0, rpe: 0, note: '' },
  ],
  races: [{ id: 9, date: '2026-11-15', name: '서울 MBN 마라톤 하프', km: 21.0975, sec: 6405 }],
};

test('한글 머리글과 BOM으로 저장', () => {
  const csv = toCSV(sample);
  assert.ok(csv.startsWith('﻿구분,날짜,종류'));
  assert.match(csv, /훈련,2026-11-24,이지런,8,8,0:45:30,145,4/);
  assert.match(csv, /대회기록,2026-11-15,대회,21.0975,,1:46:45/);
});

test('저장 → 불러오기 왕복 시 데이터 보존', () => {
  const back = fromCSV(toCSV(sample));
  assert.equal(back.logs.length, 3);
  assert.equal(back.races.length, 1);
  const strip = o => { const { id, ...rest } = o; return rest; };
  assert.deepEqual(strip(back.logs[0]), strip(sample.logs[0]));
  assert.deepEqual(strip(back.logs[1]), strip(sample.logs[1]));
  assert.deepEqual(strip(back.logs[2]), strip(sample.logs[2]));
  assert.deepEqual(strip(back.races[0]), strip(sample.races[0]));
});

test('열 순서가 바뀌거나 일부 열이 없어도 머리글 기준으로 읽음', () => {
  const csv = '날짜,구분,시간,종류,본운동거리(km),총거리(km)\n2026-12-01,훈련,50:00,템포,10,12\n';
  const st = fromCSV(csv);
  assert.equal(st.logs[0].type, 'tempo');
  assert.equal(st.logs[0].sec, 3000);
  assert.equal(st.logs[0].km, 12);
});

test('잘못된 파일 처리', () => {
  assert.equal(fromCSV('a,b\n1,2'), null);
  assert.throws(() => fromCSV('구분,날짜\n훈련,2026/12/01'), /2행/);
});

test('따옴표·CRLF 파싱', () => {
  assert.deepEqual(parseCSV('a,"b,""c"""\r\n1,2\r\n'), [['a', 'b,"c"'], ['1', '2']]);
  assert.equal(CSV_COLS[0], '구분');
});
