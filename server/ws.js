const { WebSocketServer } = require('ws');
const { verifyToken, COOKIE_NAME } = require('./auth');

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.trim().split('=');
        return [key, decodeURIComponent(rest.join('='))];
      })
  );
}

function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return;
    const cookies = parseCookies(req.headers.cookie);
    const payload = cookies[COOKIE_NAME] && verifyToken(cookies[COOKIE_NAME]);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }));
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.isAlive = true;
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(message);
    });
  }

  return { wss, broadcast };
}

module.exports = { setupWebSocket };
