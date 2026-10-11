/* 时间窗口过滤规则回归测试：近 180 天保留 / 过期剔除 / 边界情况 */
const fs = require('fs');
const P = 'C:/Users/lulu0/WorkBuddy/2026-09-23-19-40-28/starhub/index.html';
const html = fs.readFileSync(P, 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// 抽出规则函数本体（MAX_AGE_DAYS / withinWindow / freshOnly），独立求值
const pick = re => {
  const m = src.match(re);
  if (!m) throw new Error('未找到：' + re);
  return m[0];
};
const code = [
  pick(/const MAX_AGE_DAYS = [\s\S]*?const MAX_AGE_MS = [^;]+;/),
  pick(/function withinWindow\(p\)\{[\s\S]*?\n\}/),
  pick(/function freshOnly\(list\)\{[^}]*\}/),
  'return { MAX_AGE_DAYS, MAX_AGE_MS, withinWindow, freshOnly };',
].join('\n');
const { MAX_AGE_DAYS, MAX_AGE_MS, withinWindow, freshOnly } = new Function(code)();

let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const DAY = 86400e3;

ok('常量为 180 天', MAX_AGE_DAYS === 180 && MAX_AGE_MS === 180 * DAY);
ok('今天发布的保留', withinWindow({ time: Date.now() - 3600e3 }));
ok('179 天前保留', withinWindow({ time: Date.now() - 179 * DAY }));
ok('181 天前剔除', withinWindow({ time: Date.now() - 181 * DAY }) === false);
ok('365 天前剔除', withinWindow({ time: Date.now() - 365 * DAY }) === false);
ok('恰好 180 天边界保留', withinWindow({ time: Date.now() - 180 * DAY + 1000 }));
ok('时间缺失 0 保留（小红书）', withinWindow({ time: 0 }));
ok('time 字段不存在保留', withinWindow({}));
ok('time 为 null 保留', withinWindow({ time: null }));
ok('未来时间保留（时区误差）', withinWindow({ time: Date.now() + 8 * 3600e3 }));

const list = [
  { id: 'a', time: Date.now() - DAY },
  { id: 'b', time: Date.now() - 400 * DAY },
  { id: 'c', time: 0 },
];
const r = freshOnly(list);
ok('freshOnly 剔除过期项', r.length === 2 && r.map(x => x.id).join(',') === 'a,c');
ok('freshOnly 空数组不报错', freshOnly([]).length === 0);
ok('freshOnly undefined 不报错', freshOnly(undefined).length === 0);

// 采集器侧规则与前端一致（同一套判定），做一次等价性抽查
const cSrc = fs.readFileSync('C:/Users/lulu0/WorkBuddy/2026-09-23-19-40-28/starhub/collector/collect_http.js', 'utf8');
ok('采集器含 180 天窗口', /180 \* 86400e3/.test(cSrc));
ok('采集器含时间缺失保留', /if \(!t\) return true;/.test(cSrc));
ok('采集器空结果不再 exit(5)', /__HAD_POSTS/.test(cSrc));

console.log('\nRESULT: %d PASS / %d FAIL', pass, fail);
process.exit(fail ? 1 : 0);
