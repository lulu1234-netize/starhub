/* ============================================================
   星汇 · 微博采集器（本机常驻 · 复用已登录浏览器配置）
   ------------------------------------------------------------
   工作方式：
   1. 用你本机已登录的 Chrome 配置目录启动浏览器（登录态不经过任何外部服务）
   2. 打开侯明昊微博主页，捕获页面自己请求到的动态数据接口
   3. 解析出正文 / 发布时间 / 原帖链接 / 图片，写入 posts.json
   4. 前端 index.html 启动时读取 posts.json，有真数据就用真数据
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'posts.json');
const LOG_FILE = path.join(__dirname, 'collect.log');

const CHROME = 'C:\\Users\\lulu0\\.agent-browser\\browsers\\chrome-154.0.8037.57\\chrome.exe';
const PROFILE = path.join(ROOT, 'browser-profile');

/* 追踪目标：一个明星下可挂多个账号源 */
const TARGETS = [
  { star: 'hmh', name: '侯明昊', uid: '1831550987', kind: 'own',      tag: '本人' },
  { star: 'hmh', name: '碧血蝉官博', uid: '', kind: 'related', tag: '剧方官博' }
];

const log = [];
function say(s) { const t = '[' + new Date().toLocaleString('zh-CN') + '] ' + s; log.push(t); console.log(t); }

/* 微博 created_at 解析： "Wed Sep 23 10:22:15 +0800 2026" / "09-17 19:07" / "今天 10:22" */
function parseTime(raw) {
  if (!raw) return 0;
  const now = new Date();
  let m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  m = String(raw).match(/^[A-Za-z]{3} [A-Za-z]{3} (\d{2}) (\d{2}):(\d{2}):(\d{2}) \+0800 (\d{4})$/);
  if (m) {
    const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const mon = MON[String(raw).slice(4, 7)];
    return new Date(+m[5], mon, +m[1], +m[2], +m[3], +m[4]).getTime();
  }
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
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

/* 归一化微博动态对象 */
function norm(mb, target) {
  if (!mb) return null;
  const uid = (mb.user && mb.user.id) ? String(mb.user.id) : target.uid;
  const bid = mb.bid || mb.mblogid || '';
  const id = mb.id || mb.mid || '';
  const link = bid ? `https://weibo.com/${uid}/${bid}`
    : (id ? `https://weibo.com/${uid}/${id}` : '');
  /* 图片：pics 数组 或 pic_infos 对象 */
  let pics = (mb.pics || []).map(p => (p.url || (p.large && p.large.url) || '')).filter(Boolean);
  if (!pics.length && mb.pic_infos) {
    pics = Object.values(mb.pic_infos).map(p => (p.large && p.large.url) || (p.bmiddle && p.bmiddle.url) || (p.original && p.original.url) || '').filter(Boolean);
  }
  pics = pics.slice(0, 4);
  const pg = mb.page_info || {};
  const video = !!pg.media_info || pg.type === 'video' || pg.object_type === 'video' || pg.type === '11';
  /* page_pic 可能是字符串 URL，也可能是 {url} 对象，两种都要兼容 */
  let cover = '';
  if (typeof pg.page_pic === 'string') cover = pg.page_pic;
  else if (pg.page_pic && (pg.page_pic.url || pg.page_pic.pic)) cover = pg.page_pic.url || pg.page_pic.pic;
  if (!cover && pg.pic_info && pg.pic_info.url) cover = pg.pic_info.url;
  if (!cover) {
    const mi = pg.media_info || {};
    if (typeof mi.page_pic === 'string') cover = mi.page_pic;
    else if (mi.pic_info && mi.pic_info.url) cover = mi.pic_info.url;
  }
  /* 视频帖没有 pics 时，用封面当首图展示 */
  const imgs = pics.length ? pics : (cover ? [cover] : []);
  let text = strip(mb.text || '');
  const rt = mb.retweeted_status;
  if (rt) {
    text += '\n\n转发 @' + (rt.user && rt.user.screen_name || '未知') + '：' + strip(rt.text || '');
  }
  return {
    id: id || bid,
    platform: 'weibo',
    account: (mb.user && mb.user.screen_name) || target.name,
    tag: target.tag,
    kind: target.kind,
    star: target.star,
    text: text,
    time: parseTime(mb.created_at),
    timeRaw: mb.created_at || '',
    link: link,
    pics: pics,
    imgs: imgs,
    video: video,
    cover: cover || (pics[0] || '')
  };
}

(async () => {
  say('采集器启动');
  let pw;
  try {
    pw = require(path.join('C:\\Users\\lulu0\\.workbuddy\\binaries\\node\\workspace', 'node_modules', 'playwright-core'));
  } catch (e) {
    say('驱动未安装: ' + e.message);
    fs.writeFileSync(LOG_FILE, log.join('\n'), 'utf8');
    process.exit(2);
  }
  if (!fs.existsSync(CHROME)) { say('未找到 Chrome: ' + CHROME); fs.writeFileSync(LOG_FILE, log.join('\n'), 'utf8'); process.exit(3); }

  let ctx;
  try {
    ctx = await pw.chromium.launchPersistentContext(PROFILE, {
      executablePath: CHROME,
      headless: false,
      /* 窗口移到屏幕外：既能通过微博的指纹校验（必须是真实浏览器），又不打扰日常使用 */
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu',
             '--window-position=-32000,-32000', '--window-size=1280,900']
    });
  } catch (e) {
    say('浏览器启动失败: ' + e.message);
    fs.writeFileSync(LOG_FILE, log.join('\n'), 'utf8');
    process.exit(4);
  }
  say('浏览器已启动（复用本机登录态）');

  const page = await ctx.newPage();
  const captured = [];

  page.on('response', async res => {
    const u = res.url();
    if (!/mymblog|getIndex|statuses\/show|profile\/info/i.test(u)) return;
    try {
      const j = await res.json();
      captured.push({ url: u, json: j });
      say('捕获接口: ' + u.slice(0, 100));
    } catch (e) {}
  });

  const all = { updatedAt: Date.now(), posts: [] };

  for (const t of TARGETS) {
    if (!t.uid) { say('跳过（暂无 UID）: ' + t.name); continue; }
    say('打开主页: ' + t.name + ' (' + t.uid + ')');
    try {
      await page.goto(`https://weibo.com/u/${t.uid}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(9000);
      // 页面内主动调用一次接口（同源带登录态），提高成功率
      try {
        const r = await page.evaluate(async uid => {
          const resp = await fetch(`https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=1&feature=0`, {
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
          });
          return await resp.text();
        }, t.uid);
        if (r && r.length > 50) {
          try { captured.push({ url: 'inline:' + t.uid, json: JSON.parse(r) }); say('内联调用成功'); }
          catch (e) { say('内联返回非 JSON，长度 ' + r.length); }
        }
      } catch (e) { say('内联调用失败: ' + e.message); }
    } catch (e) { say('打开失败: ' + e.message); }
  }

  // 解析捕获到的数据
  for (const c of captured) {
    const list = (c.json && c.json.data && c.json.data.list) || (c.json && c.json.data && c.json.data.cards) || [];
    for (const item of list) {
      const mb = item.mblog || item;
      if (!mb || !mb.id) continue;
      const uidInUrl = (c.url.match(/uid=(\d+)/) || [])[1] || (c.url.match(/value=(\d+)/) || [])[1];
      const t = TARGETS.find(x => x.uid && x.uid === String((mb.user && mb.user.id) || uidInUrl)) || TARGETS[0];
      const n = norm(mb, t);
      if (n && n.time) all.posts.push(n);
    }
  }

  // 去重（按 id）
  const seen = new Set();
  all.posts = all.posts.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  all.posts.sort((a, b) => b.time - a.time);
  say('共解析出 ' + all.posts.length + ' 条真实动态');

  if (all.posts.length) {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    /* 保留原始接口数据，便于排查字段 */
    try {
      fs.writeFileSync(path.join(ROOT, 'data', 'raw_last.json'),
        JSON.stringify(captured.map(c => ({ url: c.url, json: c.json })).slice(-2), null, 2), 'utf8');
    } catch (e) {}
    fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), 'utf8');
    say('已写入 ' + OUT_FILE);
    all.posts.slice(0, 5).forEach(p => say('  · ' + new Date(p.time).toLocaleString('zh-CN') + ' | ' + p.account + ' | ' + p.text.slice(0, 30)));
  } else {
    say('本次未取到数据（可能登录态过期，需重新扫码登录）');
  }

  try { await ctx.close(); } catch (e) {}
  fs.writeFileSync(LOG_FILE, log.join('\n'), 'utf8');
  say('采集结束');
  process.exit(all.posts.length ? 0 : 5);
})().catch(e => {
  say('异常: ' + e.message);
  fs.writeFileSync(LOG_FILE, log.join('\n'), 'utf8');
  process.exit(1);
});
