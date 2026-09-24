/* ============================================================
   星汇 · 抖音 / 小红书 采集器（浏览器渲染版）
   ------------------------------------------------------------
   为什么不用纯 HTTP：抖音网页版返回的是反爬 JS 虚拟机空壳，
   小红书搜索/主页数据由带签名的 XHR 二次加载，两者都无法直读。
   本采集器用真实浏览器渲染页面后取数，无需任何第三方 API Key。

   依赖：playwright（云端首选）或 puppeteer-core + 本机 Chrome/Edge（本地调试）。
   环境变量：
     DOUYIN_SECUID   抖音 sec_uid（已内置侯明昊，一般不用改）
     XHS_USER_ID     小红书 user_id（站内加密串，需登录态获取）
     XHS_COOKIE      小红书网页 Cookie（未登录会被登录墙拦截）
     STARHUB_EXT_OUT 输出文件，默认 data/posts_ext.json
     STARHUB_MAX_DETAIL 单次最多抓几个详情页补时间，默认 6
     STARHUB_EXT_KEEP 每个平台保留的最大条数，默认 40
   输出：data/posts_ext.json（由 collect_http.js 合并进 posts.json）
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = process.env.STARHUB_EXT_OUT || path.join(ROOT, 'data', 'posts_ext.json');
const MAX_DETAIL = +(process.env.STARHUB_MAX_DETAIL || 6);
const KEEP = +(process.env.STARHUB_EXT_KEEP || 40);

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* 采集目标：与 index.html 的 ACCOUNTS 保持一致 */
const TARGETS = [
  {
    star: 'hmh', name: '侯明昊', kind: 'own', tag: '本人',
    douyinSecUid: process.env.DOUYIN_SECUID ||
      'MS4wLjABAAAAY5Yd4tL9-HkMUod_aYWcI_JMPu22bwwfzTNZ2bnw7fg',
    xhsUserId: process.env.XHS_USER_ID || ''
  }
];

/* ---------------- 浏览器适配层 ---------------- */
async function launch() {
  /* 1) playwright（云端 GitHub Actions 用它，自带 chromium） */
  try {
    const { chromium } = require('playwright');
    const b = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=zh-CN']
    });
    return { kind: 'playwright', b };
  } catch (e) { /* 未安装，继续尝试下一种 */ }

  /* 2) puppeteer-core + 本机浏览器（本地调试用，浏览器路径可 CHROME_PATH 指定） */
  try {
    const puppeteer = require('puppeteer-core');
    const candidates = [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
    ].filter(Boolean);
    const exe = candidates.find(p => fs.existsSync(p));
    if (!exe) throw new Error('未找到本机浏览器');
    const b = await puppeteer.launch({
      executablePath: exe, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=zh-CN']
    });
    console.log('  [浏览器] puppeteer-core + ' + exe);
    return { kind: 'puppeteer', b };
  } catch (e) { throw new Error('无可用浏览器：请执行 npm install playwright && npx playwright install chromium（' + e.message + '）'); }
}
async function newPage(ctx) {
  const p = await ctx.b.newPage();
  await p.setUserAgent(UA_PC);
  if (p.setViewportSize) await p.setViewportSize({ width: 1440, height: 900 });
  else if (p.setViewport) await p.setViewport({ width: 1440, height: 900 });
  return p;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 抖音 ---------------- */
function parseCount(s) {
  if (!s) return null;
  s = String(s).trim();
  const m = s.match(/^([\d.]+)\s*万$/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  const m2 = s.match(/^([\d.]+)\s*亿$/);
  if (m2) return Math.round(parseFloat(m2[1]) * 100000000);
  const m3 = s.match(/^\d+$/);
  if (m3) return parseInt(s, 10);
  return null;
}
function parseDate(s) {
  if (!s) return 0;
  let m = String(s).match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  m = String(s).match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) { const n = new Date(); return new Date(n.getFullYear(), +m[1] - 1, +m[2]).getTime(); }
  return 0;
}

async function fetchDouyinList(ctx, t) {
  const page = await newPage(ctx);
  let ok = false;
  try {
    await page.goto('https://www.douyin.com/user/' + t.douyinSecUid,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(9000);
    /* 轻微滚动，触发懒加载，保证拿到更多作品 */
    await page.evaluate(() => window.scrollBy(0, 1200)).catch(() => {});
    await sleep(2500);
    const items = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[data-e2e="user-post-list"] li').forEach(li => {
        const a = li.querySelector('a[href*="/video/"]');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/video\/(\d+)/);
        if (!m) return;
        const img = li.querySelector('img');
        /* alt 是完整的作品标题；innerText 里依次是：置顶标记 / 点赞数 / 标题 */
        const lines = (li.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
        out.push({
          id: m[1],
          cover: img ? (img.src || '') : '',
          alt: img ? (img.getAttribute('alt') || '') : '',
          lines: lines
        });
      });
      return out;
    });
    ok = items.length > 0;
    return items.map(it => {
      let like = null, text = '';
      for (const ln of it.lines) {
        if (ln === '置顶') continue;
        if (like === null && /^[\d.]+(万|亿)?$/.test(ln)) { like = parseCount(ln); continue; }
        if (ln.length > text.length) text = ln;
      }
      if (!text) text = it.alt || '';
      /* alt 形如「侯明昊：标题」，去掉作者前缀避免冗余 */
      if (!text && it.alt) text = it.alt.replace(/^[^：:]{2,10}[：:]\s*/, '');
      return {
        id: 'dy_' + it.id,
        platform: 'douyin',
        account: t.name, tag: t.tag, kind: t.kind, star: t.star,
        text: (text || '').slice(0, 200),
        title: '',
        time: 0, timeRaw: '',
        link: 'https://www.douyin.com/video/' + it.id,
        pics: [], imgs: it.cover ? [it.cover] : [],
        video: true, cover: it.cover || '',
        stats: { like: like, comment: null, collect: null }
      };
    });
  } catch (e) {
    console.log('  [抖音] 列表抓取失败：' + e.message);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

/* 主页列表不含发布时间，需进详情页补；只补缺时间的条目，并限制单次数量 */
async function enrichDouyinTime(ctx, posts, oldMap) {
  const need = posts.filter(p => !p.time && !(oldMap[p.id] && oldMap[p.id].time)).slice(0, MAX_DETAIL);
  if (!need.length) return 0;
  let got = 0;
  for (const p of need) {
    const page = await newPage(ctx);
    try {
      await page.goto(p.link, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(6000);
      const info = await page.evaluate(() => {
        const t = document.body.innerText || '';
        const d = t.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/);
        return { raw: d ? d[0] : '' };
      });
      const ts = parseDate(info.raw);
      if (ts) { p.time = ts; p.timeRaw = info.raw; got++; }
    } catch (e) { /* 单条失败不影响整体 */ }
    await page.close().catch(() => {});
    await sleep(500);
  }
  return got;
}

/* ---------------- 小红书 ---------------- */
async function fetchXhs(ctx, t, cookie) {
  if (!t.xhsUserId) {
    console.log('  [小红书] 跳过：未配置 XHS_USER_ID');
    console.log('           获取方式：小红书 App 打开侯明昊主页 → 右上角分享 → 复制链接，');
    console.log('           链接 /user/profile/ 后那串即 user_id，填入仓库 Secrets 的 XHS_USER_ID。');
    return [];
  }
  if (!cookie) {
    console.log('  [小红书] 跳过：未配置 XHS_COOKIE（未登录会被登录墙拦截，取不到笔记）');
    console.log('           获取方式：电脑浏览器登录 www.xiaohongshu.com → F12 → Network →');
    console.log('           任选一个请求的 Cookie 全量复制，填入仓库 Secrets 的 XHS_COOKIE。');
    return [];
  }
  const page = await newPage(ctx);
  try {
    await page.setExtraHTTPHeaders({ Cookie: cookie, 'Accept-Language': 'zh-CN,zh;q=0.9' });
    const url = 'https://www.xiaohongshu.com/user/profile/' + t.xhsUserId;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);
    await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => {});
    await sleep(2500);
    const items = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      /* 笔记链接在两种形态里出现：/explore/<id> 或 /discovery/item/<id> */
      document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/explore\/([0-9a-fA-F]{16,32})/) || href.match(/\/discovery\/item\/([0-9a-fA-F]{16,32})/);
        if (!m) return;
        const id = m[1];
        if (seen.has(id)) return;
        seen.add(id);
        /* 卡片本体：优先整个 note-item，否则回退到 <a> 自身 */
        const card = a.closest('.note-item') || a.closest('section') || a;
        const img = card.querySelector('img');
        const lines = (card.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
        out.push({
          id,
          cover: img ? (img.src || '') : '',
          lines,
          html: (card.innerHTML || '').slice(0, 1200)
        });
      });
      return out;
    });
    return items.map(it => {
      let like = null, text = '';
      for (const ln of it.lines) {
        if (like === null && /^[\d.]+(万|亿)?$/.test(ln)) { like = parseCount(ln); continue; }
        if (!/^[\d.]+(万|亿)?$/.test(ln) && ln.length > text.length) text = ln;
      }
      return {
        id: 'xhs_' + it.id,
        platform: 'xhs',
        account: t.name, tag: t.tag, kind: t.kind, star: t.star,
        text: (text || '').slice(0, 200), title: '',
        time: 0, timeRaw: '',
        link: 'https://www.xiaohongshu.com/explore/' + it.id,
        pics: [], imgs: it.cover ? [it.cover] : [],
        video: /<video|xg-video/i.test(it.html), cover: it.cover || '',
        stats: { like: like, comment: null, collect: null }
      };
    });
  } catch (e) {
    console.log('  [小红书] 抓取失败：' + e.message);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

/* ---------------- 主流程 ---------------- */
(async () => {
  console.log('===== 星汇 · 抖音/小红书采集 =====');
  /* 读取上一次的结果：用于继承已抓到的发布时间，避免重复进详情页 */
  const oldMap = {};
  try {
    JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).posts.forEach(p => { oldMap[p.id] = p; });
  } catch (e) {}
  let cur = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'posts.json'), 'utf8'));
    (j.posts || []).forEach(p => { if (p.platform === 'douyin' || p.platform === 'xhs') cur[p.id] = p; });
  } catch (e) {}
  const timeIdx = Object.assign({}, cur, oldMap);

  let ctx = null;
  try { ctx = await launch(); console.log('  [浏览器] ' + ctx.kind + ' 已启动'); }
  catch (e) { console.log('✗ ' + e.message); process.exit(0); }   /* 无浏览器不算失败，不阻塞微博采集 */

  const all = [];
  try {
    for (const t of TARGETS) {
      const dy = await fetchDouyinList(ctx, t);
      console.log('  [抖音] 列表 ' + dy.length + ' 条');
      dy.forEach(p => { const o = timeIdx[p.id]; if (o && o.time) { p.time = o.time; p.timeRaw = o.timeRaw || ''; } });
      const got = await enrichDouyinTime(ctx, dy, timeIdx);
      console.log('  [抖音] 补充发布时间 ' + got + ' 条（共需 ' + dy.filter(p => !p.time).length + ' 条待补）');
      all.push(...dy);

      const xhs = await fetchXhs(ctx, t, process.env.XHS_COOKIE || '');
      if (xhs.length) console.log('  [小红书] ' + xhs.length + ' 条');
      xhs.forEach(p => { const o = timeIdx[p.id]; if (o && o.time) { p.time = o.time; p.timeRaw = o.timeRaw || ''; } });
      all.push(...xhs);
    }
  } finally {
    await ctx.b.close().catch(() => {});
  }

  /* 兜底：抓不到时间的条目用采集时间占位，保证能进时间线而不被过滤掉 */
  const now = Date.now();
  all.forEach(p => { if (!p.time) { p.time = now - all.indexOf(p) * 60000; p.timeRaw = p.timeRaw || ''; } });

  const seen = new Set();
  const posts = all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  posts.sort((a, b) => b.time - a.time);
  const cut = {};
  const final = posts.filter(p => { cut[p.platform] = (cut[p.platform] || 0) + 1; return cut[p.platform] <= KEEP; });

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ updatedAt: now, posts: final }, null, 2), 'utf8');
  const cnt = final.reduce((a, p) => (a[p.platform] = (a[p.platform] || 0) + 1, a), {});
  console.log('✓ 写入 ' + path.relative(ROOT, OUT_FILE) + '  共 ' + final.length + ' 条  ' + JSON.stringify(cnt));
  final.slice(0, 5).forEach(p =>
    console.log('   · [' + p.platform + '] ' + new Date(p.time).toLocaleDateString('zh-CN') + '  ' +
      String(p.text).slice(0, 24).replace(/\n/g, ' ')));
})().catch(e => { console.log('✗ 异常：' + e.message); process.exit(0); });
