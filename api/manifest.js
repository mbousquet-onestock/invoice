import { buildManifest } from '../lib/manifest.js';

/** GET /.well-known/onestock-extension.json (rewrite in vercel.json): the extension manifest for the OneStock Hub. */
export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end();
  }
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const body = JSON.stringify(buildManifest(host ? `${proto}://${host}` : ''), null, 2);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(req.method === 'HEAD' ? undefined : body);
}
