const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const httpsPort = Number(process.env.HTTPS_PORT || 8443);
const host = process.env.HOST || '127.0.0.1';
const pfxPath = process.env.HTTPS_PFX;
const rootCertPath = process.env.HTTPS_ROOT_CERT;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.rules': 'text/plain; charset=utf-8'
};

const handleRequest = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  if (url.pathname === '/attendx-dev-root.cer' && rootCertPath) {
    fs.readFile(rootCertPath, (error, data) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Development CA certificate is unavailable');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/pkix-cert',
        'Content-Disposition': 'attachment; filename="attendx-dev-root.cer"'
      });
      res.end(data);
    });
    return;
  }

  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, pathname));

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
};

const httpServer = http.createServer(handleRequest);
httpServer.listen(port, host, () => {
  console.log(`AttendX running at http://${host}:${port}/`);
});

if (pfxPath) {
  const tlsOptions = {
    pfx: fs.readFileSync(pfxPath),
    passphrase: process.env.HTTPS_PFX_PASSPHRASE
  };
  const httpsServer = https.createServer(tlsOptions, handleRequest);
  httpsServer.listen(httpsPort, host, () => {
    console.log(`AttendX secure camera link: https://${host}:${httpsPort}/`);
    if (rootCertPath) console.log(`Development CA certificate: http://${host}:${port}/attendx-dev-root.cer`);
  });
}
