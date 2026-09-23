/* 星汇 · Service Worker
   作用：让浏览器认定这是一个「可安装的 App」（部分浏览器必须有它才允许安装），
   顺便在断网时也能打开页面。
   策略：网络优先 —— 保证你看到的永远是最新的动态，只有在断网时才用缓存兜底。 */
const CACHE = 'starhub-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (!/^https?:$/.test(new URL(req.url).protocol)) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        try {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        } catch (err) { /* 忽略无法缓存的响应 */ }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
