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
     STARHUB_MAX_DETAIL 单次最多抓几个详情页补时间，默认 10
     STARHUB_EXT_KEEP 每个平台保留的最大条数，默认 40
   输出：data/posts_ext.json（由 collect_http.js 合并进 posts.json）
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = process.env.STARHUB_EXT_OUT || path.join(ROOT, 'data', 'posts_ext.json');
const MAX_DETAIL = +(process.env.STARHUB_MAX_DETAIL || 10);
const KEEP = +(process.env.STARHUB_EXT_KEEP || 40);

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ============================================================
   时间解析：统一到「北京时间 UTC+8」，不依赖运行环境时区
   ------------------------------------------------------------
   抖音/小红书给出的发布时间形态很杂：
     · 秒级时间戳 1704067200      （10 位）
     · 毫秒级时间戳 1704067200000 （13 位）
     · 绝对文案 2026-01-11 / 2026-01-11 15:30 / 2026年1月11日 15:30
     · 相对文案 刚刚 / 12分钟前 / 3小时前 / 昨天 15:30 / 2天前
   这里全部收敛为毫秒时间戳，并按东八区输出 YYYY-MM-DD HH:mm:ss。
   注意：全部走 Date.UTC + 固定偏移，不用 new Date(y,m,d)，
   避免本机(UTC+8)与 GitHub Actions(UTC) 产出不同结果。
   ============================================================ */
const TZ_OFF = 8 * 3600e3;                 /* 北京时间 = UTC+8 */

/* 东八区「墙上时间」分量 → 毫秒时间戳 */
function shParts(y, mo, d, h, mi, s) {
  return Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, s || 0) - TZ_OFF;
}
/* 毫秒时间戳 → 北京时间 YYYY-MM-DD HH:mm:ss */
function fmtShanghai(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) + TZ_OFF), p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}
const pad2 = n => String(n).padStart(2, '0');

/* 任意形态 → 毫秒时间戳；解析不了返回 0（绝不伪造） */
function toTimestamp(v, baseMs) {
  if (v === null || v === undefined || v === '') return 0;
  const base = baseMs || Date.now();

  /* 1) 纯数字：按位数判定秒 / 毫秒 */
  if (typeof v === 'number' || /^\d{9,14}$/.test(String(v).trim())) {
    const n = Number(String(v).trim());
    if (!isFinite(n) || n <= 0) return 0;
    return String(n).length >= 13 ? n : n * 1000;      /* 10 位=秒，13 位=毫秒 */
  }

  const s = String(v).trim();

  /* 2) ISO 8601（可带 Z 或 ±hh:mm） */
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], sec = +(m[6] || 0);
    const zone = m[7];
    if (!zone) return shParts(y, mo, d, h, mi, sec);                        /* 裸串按北京时间 */
    if (/^z$/i.test(zone)) return shParts(y, mo, d, h, mi, sec) + TZ_OFF;   /* Z 是 UTC，换算成北京 */
    const mm = zone.match(/([+-])(\d{2}):?(\d{2})/);
    if (mm) {
      const off = (mm[1] === '-' ? -1 : 1) * (+mm[2] * 60 + +mm[3]) * 60000;
      return Date.UTC(y, mo - 1, d, h, mi, sec) - off;
    }
  }

  /* 3) 完整年月日（中文或分隔符），后面可能跟 HH:mm[:ss] */
  m = s.match(/(\d{4})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?/);
  if (m) {
    const rest = s.slice(m.index + m[0].length);
    const tm = rest.match(/(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*[:：分]\s*(\d{1,2}))?/);
    return shParts(+m[1], +m[2], +m[3],
      tm ? +tm[1] : 0, tm ? +tm[2] : 0, tm ? +(tm[3] || 0) : 0);
  }

  /* 4) 今年内的「M-D」或「M-D HH:mm」 */
  m = s.match(/^(\d{1,2})\s*[-月/]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/);
  if (m) {
    const n = new Date(base + TZ_OFF);
    return shParts(n.getUTCFullYear(), +m[1], +m[2], m[3] ? +m[3] : 0, m[4] ? +m[4] : 0, 0);
  }

  /* 5) 相对时间文案 */
  const b = new Date(base + TZ_OFF);                    /* 基准时刻的北京墙上时间 */
  const bDay = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - TZ_OFF;
  const bTs = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(),
    b.getUTCHours(), b.getUTCMinutes(), b.getUTCSeconds()) - TZ_OFF;
  if (/刚刚|just\s*now/i.test(s)) return bTs;
  let r = s.match(/(\d+)\s*秒前/); if (r) return bTs - (+r[1]) * 1000;
  r = s.match(/(\d+)\s*分(?:钟)?前/); if (r) return bTs - (+r[1]) * 60000;
  r = s.match(/(\d+)\s*小?时前/); if (r) return bTs - (+r[1]) * 3600000;
  r = s.match(/(\d+)\s*天(?:前)/); if (r) return bTs - (+r[1]) * 86400000;
  r = s.match(/(\d+)\s*(?:周|星期)前/); if (r) return bTs - (+r[1]) * 604800000;
  r = s.match(/(\d+)\s*个?月前/); if (r) return bTs - (+r[1]) * 30 * 86400000;
  r = s.match(/(\d+)\s*年前/); if (r) return bTs - (+r[1]) * 365 * 86400000;
  const hm = s.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  const hh = hm ? +hm[1] : 0, mi2 = hm ? +hm[2] : 0;
  if (/昨天|昨日/.test(s)) return bDay - 86400000 + (hh * 3600e3 + mi2 * 60e3);
  if (/前天/.test(s)) return bDay - 2 * 86400000 + (hh * 3600e3 + mi2 * 60e3);
  if (/今天|今日/.test(s)) return bDay + (hh * 3600e3 + mi2 * 60e3);

  /* 6) 最后兜底交给 Date */
  const t = Date.parse(s);
  return isFinite(t) ? t : 0;
}

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
      executablePath: exe, headless: true,
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

/* 拦截主页的接口响应：aweme_list[].create_time 是秒级 Unix 时间戳，
   精确到秒、一次拿全，比逐条打开详情页可靠得多。只取时间，不动其它字段。 */
function hookDouyinApi(page, sink) {
  page.on('response', async res => {
    try {
      const u = (typeof res.url === 'function' ? res.url() : res.url) || '';
      if (!/aweme\/v1\/web\/aweme\/(post|detail)|aweme\/post\/|aweme\/v1\/web\/im\/|\/aweme\/v1\/web\/query\/user\/post/.test(u)) return;
      const st = typeof res.status === 'function' ? res.status() : res.status;
      if (st && st >= 400) return;
      const txt = await res.text();
      if (!txt || txt[0] !== '{') return;
      const j = JSON.parse(txt);
      let list = j.aweme_list || (j.data && j.data.aweme_list) || [];
      if (!list.length && j.aweme_detail) list = [j.aweme_detail];
      (list || []).forEach(a => {
        if (!a) return;
        const id = a.aweme_id || a.awemeId;
        const ct = (a.create_time != null) ? a.create_time : a.createTime;
        if (id && ct) sink[String(id)] = Number(ct);
      });
    } catch (e) { /* 单个响应解析失败不影响整体 */ }
  });
}

/* 页面内嵌 JSON 兜底：从 _ROUTER_DATA / RENDER_DATA / __INIT_PROPS__ 里
   深挖 aweme_id 与 create_time 的配对 */
async function scrapeEmbeddedTimes(page) {
  const fn = () => {
    const out = {};
    const visit = (n, depth) => {
      if (!n || depth > 14) return;
      if (typeof n === 'string') {
        if (n.length > 2 && (n[0] === '{' || n[0] === '[')) {
          try { visit(JSON.parse(n), depth + 1); } catch (e) {}
        }
        return;
      }
      if (typeof n !== 'object') return;
      if (Array.isArray(n)) { for (const v of n) visit(v, depth + 1); return; }
      const id = n.aweme_id || n.awemeId;
      const ct = (n.create_time != null) ? n.create_time : n.createTime;
      if (id && ct) out[String(id)] = Number(ct);
      for (const k in n) visit(n[k], depth + 1);
    };
    try {
      ['_ROUTER_DATA', 'RENDER_DATA', '__INIT_PROPS__', '__NUXT__', '_SSR_DATA'].forEach(k => {
        const v = window[k];
        if (v) visit(v, 0);
      });
    } catch (e) {}
    return out;
  };
  try { return await page.evaluate(fn); } catch (e) { return {}; }
}

async function fetchDouyinList(ctx, t) {
  const page = await newPage(ctx);
  const apiTimes = {};
  hookDouyinApi(page, apiTimes);
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
    /* 接口数据优先，内嵌 JSON 兜底 */
    const embedded = await scrapeEmbeddedTimes(page);
    const times = Object.assign({}, embedded, apiTimes);
    console.log('  [抖音] 时间来源：接口 ' + Object.keys(apiTimes).length +
      ' 条 / 内嵌 ' + Object.keys(embedded).length + ' 条');
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
      const ct = times[it.id];
      const ts = ct ? toTimestamp(ct) : 0;
      return {
        id: 'dy_' + it.id,
        platform: 'douyin',
        account: t.name, tag: t.tag, kind: t.kind, star: t.star,
        text: (text || '').slice(0, 200),
        title: '',
        time: ts, timeRaw: ct ? String(ct) : '',
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

/* 时间精度分级：只允许"越补越精"，不允许被低精度值覆盖 */
function timePrecision(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  if (/^\d{9,14}$/.test(s)) return 3;   /* Unix 时间戳，精确到秒 */
  if (/[:：]/.test(s)) return 2;        /* 带时分 */
  return 1;                              /* 只有日期 */
}

/* 主页接口没覆盖到的老作品，进详情页补时间。
   详情页同样先取内嵌 JSON（精确到秒），再退化到正文文案
   （绝对日期带 HH:mm，或「3小时前」「昨天 15:30」这类相对文案）。 */
async function enrichDouyinTime(ctx, posts) {
  const noTime = posts.filter(p => !p.time);
  /* 精度不足 2（即缺时分）的，排在无时间条目之后补 */
  const rough = posts.filter(p => p.time && timePrecision(p.timeRaw) < 2);
  const need = noTime.concat(rough).slice(0, MAX_DETAIL);
  if (!need.length) return 0;
  let got = 0;
  for (const p of need) {
    const page = await newPage(ctx);
    try {
      await page.goto(p.link, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(6000);
      const ct = Object.values(await scrapeEmbeddedTimes(page))[0];
      let ts = ct ? toTimestamp(ct) : 0, raw = ct ? String(ct) : '';
      if (!ts) {
        const rawText = await page.evaluate(() => {
          const t = document.body.innerText || '';
          let m = t.match(/\d{4}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}\s*日?(?:\s*\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?)?/);
          if (m) return m[0];
          m = t.match(/(?:昨天|前天|今天)?\s*\d{1,2}\s*[:：]\s*\d{2}|刚刚|\d+\s*(?:秒|分钟|小时|天|周|个月)前/);
          return m ? m[0] : '';
        });
        if (rawText) { ts = toTimestamp(rawText); raw = rawText; }
      }
      /* 只在新值更精确时才覆盖，避免把精确到秒的接口值换成"只有日期"的文案 */
      if (ts && timePrecision(raw) > timePrecision(p.timeRaw)) {
        p.time = ts; p.timeRaw = raw; got++;
      }
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
      /* 小红书卡片上常见「3小时前」「昨天」「05-21」这类时间文案 */
      const raw = (it.lines || []).find(l =>
        /刚刚|\d+\s*(?:秒|分钟|小时|天|周|个月)前|昨天|前天|今天|\d{4}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}|^\d{1,2}\s*[-月/]\s*\d{1,2}\s*日?$/.test(l)
      ) || '';
      return {
        id: 'xhs_' + it.id,
        platform: 'xhs',
        account: t.name, tag: t.tag, kind: t.kind, star: t.star,
        text: (text || '').slice(0, 200), title: '',
        time: toTimestamp(raw), timeRaw: raw,
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
/* 旧版本曾用 now - i*60000 伪造过一批占位时间，它们没有 timeRaw 佐证。
   判定"可信时间"必须同时有时间戳和来源文案，否则本轮重新采集。 */
function trustedTime(o) { return o && o.time && o.timeRaw ? o.time : 0; }

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
      console.log('  [抖音] 列表 ' + dy.length + ' 条，其中 ' +
        dy.filter(p => p.time).length + ' 条直接拿到精确时间');
      /* 本轮接口没覆盖到的，继承历史可信时间 */
      dy.forEach(p => {
        if (!p.time) {
          const o = trustedTime(timeIdx[p.id]);
          if (o) { p.time = o; p.timeRaw = timeIdx[p.id].timeRaw || ''; }
        }
      });
      const got = await enrichDouyinTime(ctx, dy);
      console.log('  [抖音] 详情页补时间 ' + got + ' 条（仍需补 ' + dy.filter(p => !p.time).length + ' 条）');
      all.push(...dy);

      const xhs = await fetchXhs(ctx, t, process.env.XHS_COOKIE || '');
      if (xhs.length) console.log('  [小红书] ' + xhs.length + ' 条');
      xhs.forEach(p => {
        if (!p.time) {
          const o = trustedTime(timeIdx[p.id]);
          if (o) { p.time = o; p.timeRaw = timeIdx[p.id].timeRaw || ''; }
        }
      });
      all.push(...xhs);
    }
  } finally {
    await ctx.b.close().catch(() => {});
  }

  /* 不再伪造时间：抓不到就保持 0，排序时落到末尾，下一轮继续尝试补 */
  all.forEach(p => { p.time = p.time || 0; p.timeStr = fmtShanghai(p.time); });

  const seen = new Set();
  const posts = all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  /* 按发布时间倒序：最新发布的排最前；未知时间(0)沉底 */
  posts.sort((a, b) => (b.time || 0) - (a.time || 0));
  const cut = {};
  const final = posts.filter(p => { cut[p.platform] = (cut[p.platform] || 0) + 1; return cut[p.platform] <= KEEP; });

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ updatedAt: Date.now(), posts: final }, null, 2), 'utf8');
  const cnt = final.reduce((a, p) => (a[p.platform] = (a[p.platform] || 0) + 1, a), {});
  console.log('✓ 写入 ' + path.relative(ROOT, OUT_FILE) + '  共 ' + final.length + ' 条  ' + JSON.stringify(cnt));
  final.slice(0, 8).forEach(p =>
    console.log('   · [' + p.platform + '] ' + (p.timeStr || '时间未知') + '  ' +
      String(p.text).slice(0, 24).replace(/\n/g, ' ')));
})().catch(e => { console.log('✗ 异常：' + e.message); process.exit(0); });
