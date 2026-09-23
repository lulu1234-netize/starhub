/* ============================================================
   星汇 · 本地服务
   ------------------------------------------------------------
   · 静态托管 App 页面（手机/电脑浏览器访问即可用）
   · 提供 /api/posts 给前端读取采集到的真实动态
   · 内置定时采集：默认每 10 分钟自动抓一次新动态
   · 访问 /api/refresh 可手动立即抓取一次
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = process.env.PORT || 8787;
const INTERVAL_MIN = parseInt(process.env.INTERVAL || '10', 10); // 采集间隔（分钟）

const POSTS = path.join(ROOT, 'data', 'posts.json');
const COLLECT = path.join(ROOT, 'collector', 'collect.js');
const LOG = path.join(ROOT, 'collector', 'server.log');

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.webmanifest':'application/manifest+json', '.txt':'text/plain; charset=utf-8' };

let busy = false;
let lastRun = 0, lastMsg = '尚未采集';

function say(s) {
  const line = '[' + new Date().toLocaleString('zh-CN') + '] ' + s;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n', 'utf8'); } catch (e) {}
}

function runScript(file, cb){
  const p = spawn(process.execPath, [path.join(ROOT, 'collector', file)], { cwd: ROOT, windowsHide: true });
  let buf = '';
  p.stdout.on('data', d => { buf += d.toString(); });
  p.stderr.on('data', d => { buf += d.toString(); });
  p.on('close', code => {
    const brief = buf.trim().split('\n').filter(Boolean).slice(0, 2).join(' / ');
    say(file + ' 退出码 ' + code + (brief ? ' | ' + brief : ''));
    cb(code);
  });
}

/* 采集：优先轻量模式（纯 HTTP + Cookie，秒级完成、不弹浏览器）；
   失败时回退到浏览器模式（会复用登录态刷新 Cookie） */
function collect(reason) {
  if (busy) { say('采集进行中，跳过本次（' + reason + '）'); return; }
  busy = true; lastRun = Date.now();
  say('开始采集（' + reason + '）');
  runScript('collect_http.js', code => {
    if (code === 0) return finish(true);
    say('轻量采集失败，改用浏览器模式…');
    runScript('collect.js', c => finish(c === 0));
  });
}
function finish(ok){
  busy = false;
  let n = 0;
  try { n = JSON.parse(fs.readFileSync(POSTS, 'utf8')).posts.length; } catch (e) {}
  lastMsg = (ok ? '成功' : '失败') + '，共 ' + n + ' 条 · ' + new Date().toLocaleString('zh-CN')
          + (ok ? '' : '（若持续失败，请重新登录微博刷新 Cookie）');
  say('采集结束：' + lastMsg);
}

function sendJSON(res, obj) {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length,
    'Cache-Control': 'no-store' });
  res.end(b);
}

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);

  if (u === '/api/posts') {
    try {
      const d = JSON.parse(fs.readFileSync(POSTS, 'utf8'));
      sendJSON(res, { ok: true, updatedAt: d.updatedAt, posts: d.posts });
    } catch (e) { sendJSON(res, { ok: false, error: '暂无采集数据', posts: [] }); }
    return;
  }
  if (u === '/api/status') {
    sendJSON(res, { ok: true, busy, lastRun, lastMsg, intervalMin: INTERVAL_MIN,
      hasData: fs.existsSync(POSTS) });
    return;
  }
  if (u === '/api/refresh') {
    collect('手动触发');
    sendJSON(res, { ok: true, msg: '已开始采集，约 30 秒后刷新页面查看' });
    return;
  }

  let file = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
});

/* 端口已被占用 = 服务本来就在跑，友好提示而不是报错崩溃 */
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    say('端口 ' + PORT + ' 已被占用 —— 说明星汇服务已经在运行了，无需重复启动。');
    say('直接在浏览器打开 http://localhost:' + PORT + ' 即可使用。');
    try { require('child_process').exec('start http://localhost:' + PORT); } catch (x) {}
    process.exit(0);
  }
  say('服务启动失败：' + e.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  say('星汇服务已启动：http://localhost:' + PORT);
  say('采集间隔：每 ' + INTERVAL_MIN + ' 分钟一次');
  const os = require('os');
  const nets = os.networkInterfaces();
  Object.values(nets).flat().forEach(n => {
    if (n && n.family === 'IPv4' && !n.internal) say('手机同 WiFi 可访问：http://' + n.address + ':' + PORT);
  });
  /* 启动采集：若数据还是新鲜的（默认 60 分钟内），就不重复打扰 */
  setTimeout(() => {
    let fresh = false;
    try {
      const d = JSON.parse(fs.readFileSync(POSTS, 'utf8'));
      fresh = Date.now() - (d.updatedAt || 0) < 60 * 60000;
    } catch (e) {}
    if (fresh) say('已有近期数据，启动阶段跳过采集');
    else collect('服务启动');
  }, 8000);
  setInterval(() => collect('定时'), INTERVAL_MIN * 60000);
});
