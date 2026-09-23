/* 把本机导出的微博 Cookie 复制到剪贴板，方便粘贴到 GitHub 的 Secrets 里。
   用法：node collector/copy_cookie.js
   说明：Cookie 只存在你本机 data/cookies.json，不会被提交到 GitHub。 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'cookies.json');

let str = process.env.WEIBO_COOKIE || '';
if (!str) {
  try { str = JSON.parse(fs.readFileSync(FILE, 'utf8')).cookie || ''; } catch (e) {}
}
if (!str) {
  console.log('没有找到 Cookie。请先确认 data/cookies.json 存在，或重新登录微博后再导出。');
  process.exit(1);
}
const at = (() => {
  try { return new Date(JSON.parse(fs.readFileSync(FILE, 'utf8')).exportedAt).toLocaleString('zh-CN'); }
  catch (e) { return '未知'; }
})();
execSync('clip', { input: str });
console.log('==========================================');
console.log(' Cookie 已复制到剪贴板！');
console.log(' 长度：' + str.length + ' 字符，导出时间：' + at);
console.log(' 下一步：GitHub 仓库 → Settings → Secrets and');
console.log(' variables → Actions → New repository secret');
console.log(' Name 填：WEIBO_COOKIE');
console.log(' Secret 直接按 Ctrl+V 粘贴即可。');
console.log('==========================================');
