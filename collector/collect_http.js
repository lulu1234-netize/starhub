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

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = process.env.STARHUB_OUT || path.join(ROOT, 'data', 'posts.json');
const COOKIE_FILE = process.env.STARHUB_COOKIE || path.join(ROOT, 'data', 'cookies.json');

/* Cookie 也可通过环境变量注入（云端部署时用 secret，不落盘） */
function getCookie() {
  if (process.env.WEIBO_COOKIE) return process.env.WEIBO_COOKIE;
  try { return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8')).cookie; } catch (e) { return ''; }
}

const TARGETS = JSON.parse(process.env.STARHUB_TARGETS || JSON.stringify([
  { star: 'hmh', name: '侯明昊', uid: '1831550987', kind: 'own', tag: '本人' }
]));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function parseTime(raw) {
  if (!raw) return 0;
  const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  let m = String(raw).match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) \+0800 (\d{4})$/);
  if (m) return new Date(+m[6], MON[m[1]], +m[2], +m[3], +m[4], +m[5]).getTime();
  m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  const now = new Date();
  m = String(raw).match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (m) return new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]).getTime();
  m = String(raw).match(/(今天|昨天)\s*(\d{2}):(\d{2})/);
  if (m) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[2], +m[3]);
    if (m[1] === '昨天') d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  m = String(raw).match(/(\d+)\s*(分钟|小时|天)前/);
  if (m) return now.getTime() - (+m[1]) * (m[2] === '分钟' ? 6e4 : m[2] === '小时' ? 36e5 : 864e5);
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

(async () => {
  const cookie = getCookie();
  if (!cookie) {
    console.log('缺少 Cookie：请先运行 export_cookies.js，或在云端配置 WEIBO_COOKIE 环境变量');
    process.exit(2);
  }
  /* 读取上一次的数据，用于识别"新帖" */
  let oldIds = new Set();
  try { JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).posts.forEach(p => oldIds.add(p.id)); } catch (e) {}
  const all = { updatedAt: Date.now(), posts: [] };
  for (const t of TARGETS) {
    if (!t.uid) continue;
    try {
      const list = await fetchOne(t, cookie, 1);
      console.log(`[${t.name}] 取到 ${list.length} 条`);
      all.posts = all.posts.concat(list);
    } catch (e) {
      console.log(`[${t.name}] 失败：${e.message}`);
    }
  }
  const seen = new Set();
  all.posts = all.posts.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  all.posts.sort((a, b) => b.time - a.time);
  if (!all.posts.length) { console.log('未取到数据（Cookie 可能过期）'); process.exit(5); }
  fs.mkdirSync(path.dirname(path.resolve(OUT_FILE)), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), 'utf8');
  console.log('已写入 ' + OUT_FILE + '，共 ' + all.posts.length + ' 条');
  const fresh = oldIds.size ? all.posts.filter(p => !oldIds.has(p.id)) : [];
  if (fresh.length) console.log('发现新帖 ' + fresh.length + ' 条');
  await pushNew(fresh);
  all.posts.slice(0, 3).forEach(p =>
    console.log('  · ' + new Date(p.time).toLocaleString('zh-CN') + ' | ' + p.text.slice(0, 30).replace(/\n/g, ' ')));
})().catch(e => { console.log('异常：' + e.message); process.exit(1); });
