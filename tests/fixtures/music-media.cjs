const http = require('node:http');
const { once } = require('node:events');

function wave(seconds) {
  const samples = Math.round(seconds * 48000);
  const bytes = Buffer.alloc(44 + samples * 4);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(192000, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 4, 40);
  for (let sample = 0; sample < samples; sample++) {
    const at = sample / 48000;
    const value = Math.round(10000 * Math.sin(2 * Math.PI * (220 * at + at * at)));
    bytes.writeInt16LE(value, 44 + sample * 4);
    bytes.writeInt16LE(value, 46 + sample * 4);
  }
  return bytes;
}

async function server(t, handler) {
  const sockets = new Set();
  const requests = [];
  const instance = http.createServer((request, response) => {
    requests.push({ range: request.headers.range, ifRange: request.headers['if-range'] });
    handler(request, response);
  });
  instance.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve()));
  });
  const url = `http://127.0.0.1:${instance.address().port}/authored`;
  const request = (_validatedUrl, headers, signal) => new Promise((resolve, reject) => {
    const outgoing = http.request(url, { headers, signal, agent: false }, response => {
      response.on('error', reject);
      resolve(response);
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
  return { url, requests, request };
}

function range(request, bytes) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = Math.min(bytes.length - 1, match?.[2] ? Number(match[2]) : bytes.length - 1);
  return { start, end };
}

function send(request, response, bytes, options = {}) {
  const { start, end } = range(request, bytes);
  if (start >= bytes.length) {
    response.writeHead(416, { 'Content-Range': `bytes */${bytes.length}`, Connection: 'close' }).end();
    return;
  }
  const servedEnd = Math.min(end, options.segmentEnd ?? end);
  response.writeHead(206, {
    'Content-Type': options.contentType || 'audio/wav', 'Accept-Ranges': 'bytes',
    'Content-Length': servedEnd - start + 1,
    'Content-Range': `bytes ${start}-${servedEnd}/${bytes.length}`,
    ETag: options.etag || '"authored-v1"', Connection: 'close',
  });
  response.end(bytes.subarray(start, Math.min(servedEnd + 1, options.cut ?? bytes.length)));
}

module.exports = { wave, server, range, send };
