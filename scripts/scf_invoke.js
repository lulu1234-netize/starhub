/* 极简腾讯云 SCF 调用脚本（仅 Invoke，用于 GitHub Actions 定时触发抖音采集）
 * 凭据从环境变量读取：TC_SECRET_ID / TC_SECRET_KEY（在 GitHub Secrets 中配置）。
 * 用法：node scripts/scf_invoke.js [函数名]
 * 函数名默认 starhub-douyin，地域 ap-guangzhou，命名空间 default。
 */
const https = require('https');
const crypto = require('crypto');

const REGION = 'ap-guangzhou';
const HOST = 'scf.tencentcloudapi.com';
const SERVICE = 'scf';
const VERSION = '2018-04-16';
const FUNC = process.argv[2] || 'starhub-douyin';

function creds() {
  const id = process.env.TC_SECRET_ID, key = process.env.TC_SECRET_KEY;
  if (!id || !key) throw new Error('缺少 TC_SECRET_ID / TC_SECRET_KEY 环境变量');
  return { id, key };
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();

function api(action, params) {
  const c = creds();
  const payload = JSON.stringify(params || {});
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders =
    'content-type:application/json; charset=utf-8\n' +
    'host:' + HOST + '\n' +
    'x-tc-action:' + action.toLowerCase() + '\n';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(payload)].join('\n');
  const scope = date + '/' + SERVICE + '/tc3_request';
  const stringToSign = ['TC3-HMAC-SHA256', ts, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac('TC3' + c.key, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const sig = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const auth = 'TC3-HMAC-SHA256 Credential=' + c.id + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + sig;
  const body = Buffer.from(payload, 'utf8');
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST, method: 'POST', path: '/', timeout: 320000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length, Host: HOST,
        'X-TC-Action': action, 'X-TC-Version': VERSION,
        'X-TC-Timestamp': String(ts), 'X-TC-Region': REGION, Authorization: auth
      }
    }, res => {
      let buf = ''; res.setEncoding('utf8'); res.on('data', d => buf += d);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) { return reject(new Error(action + ' 响应非 JSON：' + buf.slice(0, 200))); }
        const r = j.Response || {};
        if (r.Error) return reject(new Error(action + ' 失败：' + r.Error.Code + ' ' + r.Error.Message));
        resolve(r);
      });
    });
    req.on('timeout', () => req.destroy(new Error(action + ' 超时')));
    req.on('error', reject);
    req.end(body);
  });
}

(async () => {
  const t0 = Date.now();
  const r = await api('Invoke', { FunctionName: FUNC, Namespace: 'default', InvocationType: 'RequestResponse', LogType: 'Tail' });
  console.log('调用耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (r.Log) {
    console.log('---- 函数日志 ----');
    console.log(Buffer.from(r.Log, 'base64').toString('utf8').split('\n').map(l => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '')).join('\n'));
  }
  const msg = r.Result ? r.Result.RetMsg : '';
  try { console.log('---- 返回值 ----\n' + JSON.stringify(JSON.parse(msg), null, 2).slice(0, 2000)); }
  catch (e) { if (msg) console.log('---- 返回值 ----\n' + String(msg).slice(0, 1500)); }
  if (r.Result && r.Result.ErrMsg) console.log('ErrMsg: ' + r.Result.ErrMsg);
})().catch(e => { console.log('✗ ' + e.message); process.exit(1); });
