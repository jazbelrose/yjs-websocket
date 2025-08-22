// persistence.js

// A dummy in-memory persistence class that mimics the RedisPersistence API.
class InMemoryPersistence {
  constructor() {

    this.boundDocs = new Set();
  }

  /**
   * Binds the document state.
   * If the document is already bound, log a warning and skip.
   *
   * @param {string} name - The document name (or room ID).
   * @param {Y.Doc} doc - The Yjs document instance.
   */
  async bindState(name, doc) {
    // (Insert any additional logic to initialize binding if needed.)       
    this.boundDocs.add(name);
    console.log(`Bound document: ${name}`);
  }

  /**
   * Writes the current state of the document.
   *
   * @param {string} name - The document name.
   * @param {Y.Doc} doc - The Yjs document instance.
   */
  async writeState(name, doc) {
    // Instead of writing to Redis, just log the action.
    console.log(`Writing state for ${name}`);
  }
}

// Create and export our in-memory persistence instance
const persistence = new InMemoryPersistence();
module.exports.persistence = persistence;


