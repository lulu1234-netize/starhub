/* 时间解析自检：验证秒/毫秒时间戳、绝对文案、相对文案、时区四条差异路径 */
const src = require('fs').readFileSync(require('path').join(__dirname, 'collect_headless.js'), 'utf8');
const body = src.slice(src.indexOf('const TZ_OFF'), src.indexOf('/* 采集目标'));
const mod = new Function(body + '\nreturn { toTimestamp, fmtShanghai };')();
const { toTimestamp, fmtShanghai } = mod;

const BASE = Date.UTC(2026, 8, 25, 0, 0, 0) - 8 * 3600e3;   /* 2026-09-25 00:00 北京 */
const cases = [
  /* Unix 时间戳是绝对时刻：1704067200 = 2024-01-01T00:00Z，北京时间 +8h */
  ['1704067200',            '2024-01-01 08:00:00'],  /* 10 位秒级 */
  ['1704067200000',         '2024-01-01 08:00:00'],  /* 13 位毫秒级 */
  [1704067200,              '2024-01-01 08:00:00'],  /* 数字型秒 */
  ['2026-01-11',            '2026-01-11 00:00:00'],  /* 纯日期 */
  ['2026-01-11 15:30',      '2026-01-11 15:30:00'],  /* 日期+时分 */
  ['2026-01-11 15:30:07',   '2026-01-11 15:30:07'],  /* 完整 */
  ['2026年1月11日 15:30',   '2026-01-11 15:30:00'],  /* 中文 */
  ['2026/1/11 9:05',        '2026-01-11 09:05:00'],  /* 斜杠+单位数 */
  ['01-11 15:30',           '2026-01-11 15:30:00'],  /* 今年月日 */
  ['刚刚',                  '2026-09-25 00:00:00'],
  ['12分钟前',              '2026-09-24 23:48:00'],
  ['3小时前',               '2026-09-24 21:00:00'],
  ['昨天 15:30',            '2026-09-24 15:30:00'],
  ['前天 08:00',            '2026-09-23 08:00:00'],
  ['今天 07:20',            '2026-09-25 07:20:00'],
  ['2天前',                 '2026-09-23 00:00:00'],
  ['2024-01-01T00:00:00Z',  '2024-01-01 08:00:00'],  /* Z=UTC 需 +8 */
  ['2024-01-01T00:00:00',   '2024-01-01 00:00:00'],  /* 裸串按北京 */
  ['',                      ''],
  ['乱七八糟',              '']
];
let fail = 0;
for (const [input, want] of cases) {
  const ts = toTimestamp(input, BASE);
  const got = fmtShanghai(ts);
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + JSON.stringify(input).padEnd(24) +
    ' → ' + (got || '(空)').padEnd(21) + (ok ? '' : ' 期望 ' + (want || '(空)')));
}
/* 时区无关性：同一输入在 UTC 与 UTC+8 环境下必须一致 */
console.log('\n时区无关性检查（模拟 TZ=UTC / TZ=Asia/Shanghai）：');
const probe = ['2026-01-11 15:30', '01-11 15:30', '昨天 15:30', '1704067200'];
const a = probe.map(s => toTimestamp(s, BASE));
const saved = process.env.TZ;
process.env.TZ = 'UTC';
const b2 = probe.map(s => toTimestamp(s, BASE));
process.env.TZ = saved || undefined;
const same = a.every((v, i) => v === b2[i]);
console.log((same ? '  ✓ 一致' : '  ✗ 不一致') + '  ' + probe.map((s, i) => s + '=' + a[i]).join('  '));
console.log(fail ? '\n✗ 失败 ' + fail + ' 例' : '\n✓ 全部 ' + cases.length + ' 例通过');
process.exit(fail ? 1 : 0);
