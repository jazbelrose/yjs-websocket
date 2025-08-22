#!/usr/bin/env node
const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection, setPersistence } = require('y-websocket/bin/utils');
const { persistence } = require('./store.cjs');

setPersistence(persistence);
console.log('[server] persistence set');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 1234);

const server = http.createServer((req, res) => {
  console.log('[http] %s %s ua=%s ip=%s',
    req.method, req.url, req.headers['user-agent'], req.socket?.remoteAddress);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('okay');
});

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = req.url || '/';
  const docName = decodeURIComponent(url.replace(/^\//, '') || 'default');
  console.log('[ws] connection open url=%s doc=%s ip=%s', url, docName, req.socket?.remoteAddress);

  // low-level socket logs
  ws.on('close', (code, reason) => {
    console.log('[ws] connection close doc=%s code=%s reason=%s', docName, code, reason);
  });
  ws.on('error', (err) => {
    console.error('[ws] connection error doc=%s err=%s stack=%s', docName, err?.message, err?.stack);
  });

  // let y-websocket handle the room/doc
  setupWSConnection(ws, req, { docName });
  console.log('[ws] setupWSConnection done doc=%s', docName);
});

server.on('upgrade', (req, socket, head) => {
  console.log('[upgrade] %s ip=%s ua=%s', req.url, req.socket?.remoteAddress, req.headers['user-agent']);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(port, host, () => {
  console.log(`[server] WebSocket server running at '${host}' on port ${port}`);
});
