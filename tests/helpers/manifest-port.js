const net = require('node:net');

function setBindHost(t, host) {
  const previous = process.env.MONKY_SERVE_HOST;
  if (host === undefined) delete process.env.MONKY_SERVE_HOST;
  else process.env.MONKY_SERVE_HOST = host;
  t.after(() => {
    if (previous === undefined) delete process.env.MONKY_SERVE_HOST;
    else process.env.MONKY_SERVE_HOST = previous;
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function listen(t, server = net.createServer((socket) => socket.destroy()), port = 0, host = '0.0.0.0') {
  t.after(() => closeServer(server));
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, host, exclusive: true });
  });
  return server;
}

async function freePort(t) {
  const server = await listen(t);
  const port = server.address().port;
  await closeServer(server);
  return port;
}

function captureBinds(t) {
  const original = net.Server.prototype.listen;
  const binds = [];
  t.mock.method(net.Server.prototype, 'listen', function (...args) {
    binds.push(args[0]);
    return original.apply(this, args);
  });
  return binds;
}

module.exports = { setBindHost, closeServer, listen, freePort, captureBinds };
