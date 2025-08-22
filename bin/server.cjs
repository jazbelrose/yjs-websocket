#!/usr/bin/env node

const WebSocket = require('ws');
const http = require('http');
const { setupWSConnection, setPersistence } = require('y-websocket/bin/utils');
const Y = require('yjs');


const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 1234;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('okay');
});
const wss = new WebSocket.Server({ noServer: true });

// Global cache for Y.Doc instances
const yDocs = new Map();
function getYDoc(roomId) {
  if (!yDocs.has(roomId)) {
    const doc = new Y.Doc();
    yDocs.set(roomId, doc);
  }
  return yDocs.get(roomId);
}

wss.on('connection', (ws, req) => {
  // Parse room ID from URL; "http://dummy" is just a dummy base URL for parsing
  const roomId = new URL(req.url, "http://dummy").searchParams.get("room") || "default-room";

  // Reuse or create the Y.Doc for this room
  const doc = getYDoc(roomId);

  // Setup the connection with the shared Y.Doc
  setupWSConnection(ws, req, { doc });
});

server.on('upgrade', (req, socket, head) => {
  const handleAuth = ws => {
    wss.emit('connection', ws, req);
  };
  wss.handleUpgrade(req, socket, head, handleAuth);
});

server.listen(port, host, () => {
  console.log(`WebSocket server running at '${host}' on port ${port}`);

});



