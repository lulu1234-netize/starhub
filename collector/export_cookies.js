/* 导出本机已登录的微博 Cookie（仅保存在本机 data/cookies.json）
   用途：验证「纯 HTTP + Cookie」能否直接取到动态数据 —— 这是把采集搬到云端的前提 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Users\\lulu0\\.agent-browser\\browsers\\chrome-154.0.8037.57\\chrome.exe';
const PROFILE = path.join(ROOT, 'browser-profile');

(async () => {
  const pw = require(path.join('C:\\Users\\lulu0\\.workbuddy\\binaries\\node\\workspace', 'node_modules', 'playwright-core'));
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--window-position=-32000,-32000']
  });
  const page = await ctx.newPage();
  await page.goto('https://weibo.com/u/1831550987', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const cookies = await ctx.cookies();
  const wb = cookies.filter(c => /weibo\.com$|sina\.com\.cn$|weibo\.cn$/.test(c.domain));
  const jar = {};
  wb.forEach(c => { jar[c.name] = c.value; });
  const str = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'cookies.json'),
    JSON.stringify({ exportedAt: Date.now(), cookie: str, count: wb.length }, null, 2), 'utf8');
  console.log('导出 Cookie 条数:', wb.length);
  console.log('关键登录字段:', ['SUB', 'SUBP', 'SSOLoginState'].filter(k => jar[k]).join(', ') || '（未找到登录字段）');
  console.log('长度:', str.length);
  await ctx.close();
})();
