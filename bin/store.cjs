// store.cjs
// DynamoDB-backed y-websocket persistence with a safe feature flag.
// Works with: const { setupWSConnection, setPersistence } = require('y-websocket/bin/utils');
// Then: setPersistence(require('./store.cjs').persistence)

const Y = require('yjs');

const USE_DDB = process.env.USE_DDB_PERSISTENCE === '1';

// ───────────────────────────────────────────────────────────────────────────────
// In-memory fallback (no-op persistence) – used when the flag is OFF.
// ───────────────────────────────────────────────────────────────────────────────
class InMemoryPersistence {
  constructor() { this.bound = new Set(); }
  async bindState(name, doc) {
    if (!this.bound.has(name)) this.bound.add(name);
    // Nothing to load or save; just return a cleanup hook.
    const cleanup = () => {};
    return { doc, cleanup };
  }
  async writeState(name, doc) {
    // No-op
  }
}

if (!USE_DDB) {
  console.log('[persistence] Using IN-MEMORY persistence (USE_DDB_PERSISTENCE != 1)');
  module.exports.persistence = new InMemoryPersistence();
  return;
}

// ───────────────────────────────────────────────────────────────────────────────
// DynamoDB-backed persistence
// ───────────────────────────────────────────────────────────────────────────────
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const TABLE   = process.env.DDB_TABLE        || 'Projects';
const REGION  = process.env.AWS_REGION       || process.env.DDB_REGION || 'us-west-1';
const PK      = process.env.DDB_PROJECT_PK   || 'projectId';
const DESC    = process.env.DDB_DESC_ATTR    || 'description';
const DEBOUNCE_MS = Number(process.env.PERSIST_DEBOUNCE_MS || 3000);

const ddb = new DynamoDBClient({ region: REGION });

const log = (...a) => console.log('[persistence]', ...a);
const warn = (...a) => console.warn('[persistence]', ...a);
const err = (...a) => console.error('[persistence]', ...a);

const utf8Len = (s) => Buffer.byteLength(s || '', 'utf8');

// Simple trailing debouncer per doc name
function createDebouncer(delayMs) {
  const timers = new Map();
  return (key, fn) => {
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      try { await fn(); } catch (e) { err(`save error for ${key}:`, e); }
    }, delayMs));
  };
}
const debounceSave = createDebouncer(DEBOUNCE_MS);

class DynamoDbPersistence {
  constructor() {
    this.bound = new Set();
    log(`Using DYNAMODB persistence (table=${TABLE}, region=${REGION}, pk=${PK}, attr=${DESC})`);
  }

  async _getDescription(projectId) {
    const cmd = new GetItemCommand({
      TableName: TABLE,
      Key: { [PK]: { S: projectId } },
      ProjectionExpression: '#d',
      ExpressionAttributeNames: { '#d': DESC },
    });
    const out = await ddb.send(cmd);
    const val = out?.Item?.[DESC]?.S || '';
    return val;
  }

  async _putDescription(projectId, jsonString) {
    // NOTE: DynamoDB item limit is 400 KB. Consider S3 if you approach that.
    const size = utf8Len(jsonString);
    if (size > 380 * 1024) {
      warn(`description for ${projectId} is ~${(size/1024).toFixed(1)} KB; close to 400KB limit`);
    }
    const cmd = new PutItemCommand({
      TableName: TABLE,
      Item: {
        [PK]: { S: projectId },
        [DESC]: { S: jsonString || '' },
        updatedAt: { S: new Date().toISOString() },
      },
    });
    await ddb.send(cmd);
  }

  /**
   * bindState(name, doc)
   * - Called by y-websocket when a room (docName) is first used in this process.
   * - Seeds Yjs from DynamoDB if the shared text is empty.
   * - Subscribes to doc updates and debounced-saves the serialized state back to DynamoDB.
   */
  async bindState(name, doc) {
    if (this.bound.has(name)) {
      // Already bound in this process; return a no-op cleanup.
      return { doc, cleanup: () => {} };
    }
    this.bound.add(name);

    const ytext = doc.getText('lexical');

    try {
      const fromDb = await this._getDescription(name);
      const isEmpty = ytext.length === 0;

      if (isEmpty && fromDb && fromDb.trim().length > 0) {
        // We store the serialized Lexical JSON *string* directly inside Y.Text.
        // Your client already serializes/deserializes around OnChange/initial seed.
        ytext.insert(0, fromDb);
        log(`seeded ${name} from DynamoDB (${utf8Len(fromDb)} bytes)`);
      } else {
        log(`no seed for ${name} (empty=${isEmpty}, dbLen=${utf8Len(fromDb)})`);
      }
    } catch (e) {
      err(`failed to seed ${name} from DynamoDB:`, e);
    }

    // Debounced save on updates
    const updateHandler = () => {
      debounceSave(name, async () => {
        try {
          const serialized = ytext.toString(); // serialized Lexical JSON string
          await this._putDescription(name, serialized);
          log(`saved ${name} to DynamoDB (${utf8Len(serialized)} bytes)`);
        } catch (e) {
          err(`save failure for ${name}:`, e);
        }
      });
    };

    doc.on('update', updateHandler);

    const cleanup = () => {
      try { doc.off('update', updateHandler); } catch {}
      log(`cleanup ${name}`);
    };

    return { doc, cleanup };
  }

  /**
   * writeState(name, doc)
   * - Optional final flush (e.g., on shutdown).
   */
  async writeState(name, doc) {
    try {
      const ytext = doc.getText('lexical');
      const serialized = ytext.toString();
      await this._putDescription(name, serialized);
      log(`writeState committed ${name} (${utf8Len(serialized)} bytes)`);
    } catch (e) {
      err(`writeState error for ${name}:`, e);
    }
  }
}

module.exports.persistence = new DynamoDbPersistence();
