/* ============================================================
   星汇 · 轻量采集器（纯 HTTP + Cookie，无需浏览器）
   ------------------------------------------------------------
   这是「电脑关机也能更新」的关键：不依赖本机、不启动浏览器，
   任何能跑 Node 的地方（云服务器 / GitHub Actions / Cloudflare
   Workers）都能执行，因此可以把采集搬到云端常驻。
   登录 Cookie 存放在 data/cookies.json（由 export_cookies.js
   从你本机已登录的浏览器导出），过期后重新导出即可。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = process.env.STARHUB_OUT || path.join(ROOT, 'data', 'posts.json');
const COOKIE_FILE = process.env.STARHUB_COOKIE || path.join(ROOT, 'data', 'cookies.json');

/* Cookie 也可通过环境变量注入（云端部署时用 secret，不落盘） */
function getCookie() {
  if (process.env.WEIBO_COOKIE) return process.env.WEIBO_COOKIE;
  try { return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8')).cookie; } catch (e) { return ''; }
}

const TARGETS = JSON.parse(process.env.STARHUB_TARGETS || JSON.stringify([
  { star: 'hmh', name: '侯明昊', uid: '1831550987', kind: 'own', tag: '本人' },
  { star: 'hmh', name: '侯明昊工作室', uid: '5763552342', kind: 'related', tag: '工作室' },
  { star: 'hmh', name: '侯明昊全球后援会', uid: '5702872851', kind: 'related', tag: '全球后援会' },
  { star: 'hmh', name: '侯明昊的桃园杂货铺', uid: '7821215116', kind: 'related', tag: '桃园杂货铺' },
  { star: 'hmh', name: '侯会有期-昊友汇', uid: '2125740311', kind: 'related', tag: '昊友汇' }
]));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* 微博时间同样按「北京时间」显式解析，不依赖运行环境 TZ。
   否则 GitHub Actions(UTC) 会把 +0800 的时间整体偏移 8 小时。 */
const TZ_OFF = 8 * 3600e3;
const shParts = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi, s) - TZ_OFF;
function fmtShanghai(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) + TZ_OFF), p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}
function parseTime(raw) {
  if (!raw) return 0;
  const raw0 = String(raw).trim();
  const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

  /* 微博标准格式 Thu Sep 24 13:58:51 +0800 2026 —— 按串里自带的时区偏移换算成 UTC */
  let m = raw0.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})\s+(\d{4})$/);
  if (m) {
    /* m: 1=月 2=日 3=时 4=分 5=秒 6=± 7=偏移时 8=偏移分 9=年 */
    const sign = m[6] === '-' ? -1 : 1;
    return Date.UTC(+m[9], MON[m[1]], +m[2],
      +m[3] - sign * (+m[7]), +m[4] - sign * (+m[8]), +m[5]);
  }
  /* 同上但没有时区后缀，按北京时间处理 */
  m = raw0.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/);
  if (m) return shParts(+m[6], MON[m[1]] + 1, +m[2], +m[3], +m[4], +m[5]);

  m = raw0.match(/(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return shParts(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));

  const nb = new Date(Date.now() + TZ_OFF);          /* 当前时刻的北京墙上时间 */
  const nowTs = Date.UTC(nb.getUTCFullYear(), nb.getUTCMonth(), nb.getUTCDate(),
    nb.getUTCHours(), nb.getUTCMinutes(), nb.getUTCSeconds()) - TZ_OFF;
  const dayTs = Date.UTC(nb.getUTCFullYear(), nb.getUTCMonth(), nb.getUTCDate()) - TZ_OFF;

  m = raw0.match(/^(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return shParts(nb.getUTCFullYear(), +m[1], +m[2], +m[3], +m[4], +(m[5] || 0));
  m = raw0.match(/(今天|昨天|前天)\s*(\d{1,2}):(\d{2})/);
  if (m) {
    const back = m[1] === '昨天' ? 1 : m[1] === '前天' ? 2 : 0;
    return dayTs - back * 864e5 + (+m[2]) * 3600e3 + (+m[3]) * 60e3;
  }
  m = raw0.match(/(\d+)\s*(分钟|小时|天)前/);
  if (m) return nowTs - (+m[1]) * (m[2] === '分钟' ? 6e4 : m[2] === '小时' ? 36e5 : 864e5);
  if (/刚刚/.test(raw0)) return nowTs;
  return 0;
}
function strip(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').trim();
}

function norm(mb, target) {
  if (!mb) return null;
  const uid = (mb.user && mb.user.id) ? String(mb.user.id) : target.uid;
  const bid = mb.mblogid || mb.bid || '';
  const id = mb.id || mb.mid || bid;
  const link = bid ? `https://weibo.com/${uid}/${bid}` : (id ? `https://weibo.com/${uid}/${id}` : '');
  let pics = (mb.pics || []).map(p => (p.url || (p.large && p.large.url) || '')).filter(Boolean);
  if (!pics.length && mb.pic_infos) {
    pics = Object.values(mb.pic_infos)
      .map(p => (p.large && p.large.url) || (p.bmiddle && p.bmiddle.url) || (p.original && p.original.url) || '')
      .filter(Boolean);
  }
  pics = pics.slice(0, 4);
  const pg = mb.page_info || {};
  const video = !!pg.media_info || pg.object_type === 'video' || pg.type === '11' || pg.type === 'video';
  let cover = '';
  if (typeof pg.page_pic === 'string') cover = pg.page_pic;
  else if (pg.page_pic && (pg.page_pic.url || pg.page_pic.pic)) cover = pg.page_pic.url || pg.page_pic.pic;
  if (!cover && pg.pic_info && pg.pic_info.url) cover = pg.pic_info.url;
  let text = strip(mb.text || '');
  const rt = mb.retweeted_status;
  if (rt) text += '\n\n转发 @' + ((rt.user && rt.user.screen_name) || '未知') + '：' + strip(rt.text || '');
  return {
    id: String(id), platform: 'weibo',
    account: (mb.user && mb.user.screen_name) || target.name,
    tag: target.tag, kind: target.kind, star: target.star,
    text: text, time: parseTime(mb.created_at), timeRaw: mb.created_at || '',
    link: link, pics: pics, imgs: pics.length ? pics : (cover ? [cover] : []),
    video: !!video, cover: cover || (pics[0] || '')
  };
}

async function fetchOne(target, cookie, page) {
  const url = `https://weibo.com/ajax/statuses/mymblog?uid=${target.uid}&page=${page || 1}&feature=0`;
  const r = await fetch(url, {
    headers: { Cookie: cookie, 'User-Agent': UA, Referer: `https://weibo.com/u/${target.uid}`,
      Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  if (!t.trim().startsWith('{')) throw new Error('非 JSON 响应（Cookie 可能已过期）');
  const j = JSON.parse(t);
  const list = (j.data && j.data.list) || [];
  return list.map(mb => norm(mb, target)).filter(p => p && p.time);
}

/* 发现新帖时推送到微信（Server酱）：配置了 SENDKEY 才会启用 */
async function pushNew(fresh) {
  const key = process.env.SENDKEY;
  if (!key || !fresh.length) return;
  for (const p of fresh.slice(0, 3)) {
    const title = `${p.account} 发了新动态`;
    const desp = `${new Date(p.time).toLocaleString('zh-CN')}\n\n${p.text.slice(0, 120)}\n\n[打开原帖](${p.link})`;
    try {
      await fetch(`https://sctapi.ftqq.com/${key}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title, desp }).toString()
      });
      console.log('已推送：' + title);
    } catch (e) { console.log('推送失败：' + e.message); }
  }
}

/* ---------- 图片本地化 ----------
   新浪图床防盗链已收紧：仅放行带 weibo.com/weibo.cn Referer 的请求，
   无 Referer、github.io、127.0.0.1 等一律 403；而浏览器 / WebView 都
   无法为 <img> 伪造跨域 Referer，前端无解。
   所以由采集器（GitHub Actions 云端）代为下载图片存入仓库 data/img/，
   posts.json 改写为仓库内相对路径 —— 任何端都同源直读，永久有效。 */
function imgFileName(u) {
  const m = String(u).match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  const ext = (m ? m[1] : 'jpg').toLowerCase();
  return crypto.createHash('md5').update(u).digest('hex').slice(0, 16) + '.' + (ext === 'jpeg' ? 'jpg' : ext);
}

async function localizeImages(posts) {
  const jobs = new Map();                     /* 原始 URL -> 文件名（全局去重） */
  const hit = u => typeof u === 'string' && u.indexOf('sinaimg.cn') >= 0;
  for (const p of posts) {
    for (const f of ['imgs', 'pics', 'cover']) {
      const arr = Array.isArray(p[f]) ? p[f] : [p[f]];
      for (const u of arr) if (hit(u) && !jobs.has(u)) jobs.set(u, imgFileName(u));
    }
  }
  if (!jobs.size) return;
  const IMG_DIR = path.join(ROOT, 'data', 'img');
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const list = [...jobs.entries()];
  console.log(`[图片] 需本地化 ${list.length} 张`);
  let ok = 0, fail = 0;
  const CONC = 6;                             /* 并发 6，避免触发风控 */
  for (let i = 0; i < list.length; i += CONC) {
    await Promise.all(list.slice(i, i + CONC).map(async ([u, fn]) => {
      const dest = path.join(IMG_DIR, fn);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { ok++; return; }
      try {
        const r = await fetch(u, {
          headers: { Referer: 'https://weibo.com/', 'User-Agent': UA },
          signal: AbortSignal.timeout(20000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 1000) throw new Error('too small ' + buf.length);
        fs.writeFileSync(dest, buf);
        ok++;
      } catch (e) { fail++; console.log('  [图片失败] ' + fn + ' ' + e.message); }
    }));
  }
  console.log(`[图片] 成功 ${ok} 失败 ${fail}`);
  /* 只改写下载成功的 URL；失败的保留原直链兜底 */
  const rw = u => {
    if (!hit(u)) return u;
    const dest = path.join(IMG_DIR, jobs.get(u));
    return (fs.existsSync(dest) && fs.statSync(dest).size > 0) ? 'data/img/' + jobs.get(u) : u;
  };
  for (const p of posts) {
    if (Array.isArray(p.imgs)) p.imgs = p.imgs.map(rw);
    if (Array.isArray(p.pics)) p.pics = p.pics.map(rw);
    if (typeof p.cover === 'string') p.cover = rw(p.cover);
  }
}

(async () => {
  let cookie = getCookie();
  if (!cookie) console.log('提示：缺少微博 Cookie（WEIBO_COOKIE），本次跳过微博，仍会保留抖音/小红书数据');
  /* 读取上一次的数据，用于识别"新帖" */
  let oldIds = new Set();
  try { JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).posts.forEach(p => oldIds.add(p.id)); } catch (e) {}
  const all = { updatedAt: Date.now(), posts: [] };
  for (const t of TARGETS) {
    if (!t.uid || !cookie) continue;
    try {
      const list = await fetchOne(t, cookie, 1);
      console.log(`[${t.name}] 取到 ${list.length} 条`);
      all.posts = all.posts.concat(list);
    } catch (e) {
      console.log(`[${t.name}] 失败：${e.message}`);
    }
  }
  /* 合并抖音 / 小红书采集结果（由 collect_headless.js 生成 posts_ext.json）。
     两个采集器互不依赖：外部平台没跑或失败，微博数据照常写入，不受影响。 */
  try {
    const ext = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'posts_ext.json'), 'utf8'));
    if (ext && ext.posts && ext.posts.length) {
      const have = new Set(all.posts.map(p => p.id));
      const add = ext.posts.filter(p => !have.has(p.id));
      all.posts = all.posts.concat(add);
      const ago = Math.round((Date.now() - (ext.updatedAt || 0)) / 60000);
      console.log(`[合并] 抖音/小红书 ${add.length} 条（${ago} 分钟前采集）`);
    }
  } catch (e) { /* 外部采集未跑过，忽略 */ }
  const seen = new Set();
  all.posts = all.posts.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  all.posts.sort((a, b) => b.time - a.time);
  /* 统一补上标准日期时间串 YYYY-MM-DD HH:mm:ss（北京时间） */
  all.posts.forEach(p => { p.timeStr = fmtShanghai(p.time); });
  await localizeImages(all.posts);
  if (!all.posts.length) {
    console.log('未取到微博数据（Cookie 可能过期），且没有外部平台数据');
    process.exit(5);
  }
  fs.mkdirSync(path.dirname(path.resolve(OUT_FILE)), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), 'utf8');
  const dist = all.posts.reduce((a, p) => { a[p.platform] = (a[p.platform] || 0) + 1; return a; }, {});
  console.log('已写入 ' + OUT_FILE + '，共 ' + all.posts.length + ' 条  ' + JSON.stringify(dist));
  const fresh = oldIds.size ? all.posts.filter(p => !oldIds.has(p.id)) : [];
  if (fresh.length) console.log('发现新帖 ' + fresh.length + ' 条');
  await pushNew(fresh);
  all.posts.slice(0, 3).forEach(p =>
    console.log('  · ' + new Date(p.time).toLocaleString('zh-CN') + ' | ' + p.text.slice(0, 30).replace(/\n/g, ' ')));
})().catch(e => { console.log('异常：' + e.message); process.exit(1); });
