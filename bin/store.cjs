const Y = require('yjs');

const USE_DDB = process.env.USE_DDB_PERSISTENCE === '1';
const log = (...a) => console.log('[persistence]', ...a);
const err = (...a) => console.error('[persistence]', ...a);

class InMemoryPersistence {
  async bindState(name, doc) { log('bindState (IN-MEMORY) name=%s', name); return { doc, cleanup: () => log('cleanup name=%s', name) }; }
  async writeState(name, doc) { log('writeState (IN-MEMORY) name=%s', name); }
}
if (!USE_DDB) {
  log('Using IN-MEMORY persistence (USE_DDB_PERSISTENCE != 1)');
  module.exports.persistence = new InMemoryPersistence();
  return;
}

const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const TABLE       = process.env.DDB_TABLE || 'YjsDocs';
const REGION      = process.env.AWS_REGION || 'us-west-1';
const PK          = process.env.DDB_PROJECT_PK || 'docId';     // docId
const CONTENT     = process.env.DDB_DESC_ATTR || 'content';    // content
const DEBOUNCE_MS = Number(process.env.PERSIST_DEBOUNCE_MS || 3000);

const ddb = new DynamoDBClient({ region: REGION });
const utf8Len = (s) => Buffer.byteLength(s || '', 'utf8');

// Expect room name "project/<projectId>/<subdoc>" -> docId "<projectId>#<subdoc>"
function nameToDocId(name) {
  try {
    const parts = String(name).split('/').filter(Boolean);
    if (parts[0] === 'project' && parts.length >= 3) {
      const projectId = parts[1];
      const subdoc = parts.slice(2).join(':'); // normalize any deeper segments
      return `${projectId}#${subdoc}`;
    }
    // Fallback: treat the whole name as a (legacy) project id
    return `${name}#description`;
  } catch {
    return `${name}#description`;
  }
}

function createDebouncer(delayMs) {
  const timers = new Map();
  return (key, fn) => {
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      try { await fn(); } catch (e) { err('save error name=%s err=%s', key, e?.message); }
    }, delayMs));
  };
}
const debounceSave = createDebouncer(DEBOUNCE_MS);

class DynamoDbPersistence {
  constructor() {
    log('Using DYNAMODB persistence table=%s region=%s pk=%s attr=%s debounce=%sms',
      TABLE, REGION, PK, CONTENT, DEBOUNCE_MS);
  }

  async _getContent(name) {
    const docId = nameToDocId(name);
    const cmd = new GetItemCommand({
      TableName: TABLE,
      Key: { [PK]: { S: docId } },
      ProjectionExpression: '#c',
      ExpressionAttributeNames: { '#c': CONTENT },
    });
    const out = await ddb.send(cmd);
    const val = out?.Item?.[CONTENT]?.S || '';
    log('(_getContent) room=%s docId=%s dbLen=%s', name, docId, utf8Len(val));
    return val;
  }

  async _putContent(name, json) {
    const docId = nameToDocId(name);
    const size = utf8Len(json);
    log('(_putContent) room=%s docId=%s bytes=%s', name, docId, size);

    const cmd = new UpdateItemCommand({
      TableName: TABLE,
      Key: { [PK]: { S: docId } },
      UpdateExpression: 'SET #c = :val, updatedAt = :t',
      ExpressionAttributeNames: { '#c': CONTENT },
      ExpressionAttributeValues: {
        ':val': { S: json || '' },
        ':t':   { S: new Date().toISOString() },
      },
    });
    await ddb.send(cmd);
  }

  async bindState(name, doc) {
    try {
      log('bindState name=%s', name);
      const ytext = doc.getText('lexical');
      const yLen = ytext.length;
      const fromDb = await this._getContent(name);
      const dbLen = utf8Len(fromDb);

      log('bindState status name=%s yLen=%s dbLen=%s', name, yLen, dbLen);

      if (yLen === 0 && dbLen > 0) {
        ytext.insert(0, fromDb);
        log('seeded %s from DynamoDB (%s bytes)', name, dbLen);
      } else {
        log('no seed for %s (yLen=%s, dbLen=%s)', name, yLen, dbLen);
      }

      const updateHandler = () => {
        log('update observed name=%s (debouncing %sms)', name, DEBOUNCE_MS);
        debounceSave(name, async () => {
          const serialized = ytext.toString();
          await this._putContent(name, serialized);
          log('saved %s to DynamoDB (%s bytes)', name, utf8Len(serialized));
        });
      };
      doc.on('update', updateHandler);

      const cleanup = () => {
        try { doc.off('update', updateHandler); } catch {}
        log('cleanup name=%s', name);
      };
      return { doc, cleanup };
    } catch (e) {
      err('bindState error name=%s err=%s stack=%s', name, e?.message, e?.stack);
      return { doc, cleanup: () => {} };
    }
  }

  async writeState(name, doc) {
    try {
      const ytext = doc.getText('lexical');
      const serialized = ytext.toString();
      await this._putContent(name, serialized);
      log('writeState committed %s (%s bytes)', name, utf8Len(serialized));
    } catch (e) {
      err('writeState error name=%s err=%s', name, e?.message);
    }
  }
}

module.exports.persistence = new DynamoDbPersistence();
