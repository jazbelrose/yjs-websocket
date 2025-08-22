#!/usr/bin/env node
const http = require('http');
const WebSocket = require('ws');

// 1. Import y-websocket utils
const { setupWSConnection, setPersistence } = require('y-websocket/bin/utils');

// 2. Import your persistence layer (store.cjs)
const { persistence } = require('./store.cjs');

// 3. Tell y-websocket to use DynamoDB persistence
setPersistence(persistence);

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 1234);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('okay');
});

const wss = new WebSocket.Server({ noServer: true });

// 4. Let y-websocket manage docs — don’t pass your own { doc }
wss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(port, host, () => {
  console.log(`WebSocket server running at '${host}' on port ${port}`);
});
