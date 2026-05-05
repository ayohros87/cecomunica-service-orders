/**
 * clientesService.js
 * Service layer for Firestore operations related to clients
 * Separates data access from UI logic
 */

const ClientesService = {
  /**
   * Load all clients from Firestore
   * @returns {Promise<Map<string, Object>>} Map of clientId => clientData
   */
  async loadClientes() {
    const db = firebase.firestore();
    const snapshot = await db.collection("clientes").get();
    
    const clientesMap = new Map();
    snapshot.forEach(doc => {
      const data = doc.data();
      clientesMap.set(doc.id, {
        id: doc.id,
        nombre: data.nombre || "",
        empresa: data.empresa || "",
        ...data
      });
    });
    
    return clientesMap;
  },

  /**
   * Get a single client by ID
   * @param {string} clienteId - Client ID
   * @returns {Promise<Object|null>}
   */
  async getCliente(clienteId) {
    const db = firebase.firestore();
    const doc = await db.collection("clientes").doc(clienteId).get();
    
    if (!doc.exists) return null;
    
    return {
      id: doc.id,
      ...doc.data()
    };
  },

  /**
   * Search clients by name or empresa
   * @param {string} searchTerm - Search term
   * @returns {Promise<Array<Object>>}
   */
  async searchClientes(searchTerm) {
    if (!searchTerm || searchTerm.trim() === "") {
      return [];
    }
    
    const db = firebase.firestore();
    const term = searchTerm.toLowerCase().trim();
    
    // Note: Firestore doesn't support full-text search natively
    // This loads all clients and filters client-side
    // For production, consider using Algolia or similar
    const snapshot = await db.collection("clientes").get();
    
    const results = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const nombre = (data.nombre || "").toLowerCase();
      const empresa = (data.empresa || "").toLowerCase();
      
      if (nombre.includes(term) || empresa.includes(term)) {
        results.push({
          id: doc.id,
          nombre: data.nombre || "",
          empresa: data.empresa || "",
          ...data
        });
      }
    });
    
    return results;
  },

  /**
   * Create a new client
   * @param {Object} clienteData - Client data
   * @returns {Promise<string>} New client ID
   */
  async createCliente(clienteData) {
    const db = firebase.firestore();
    const docRef = await db.collection("clientes").add({
      ...clienteData,
      fecha_creacion: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    return docRef.id;
  },

  /**
   * Update client data
   * @param {string} clienteId - Client ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async updateCliente(clienteId, updates) {
    const db = firebase.firestore();
    await db.collection("clientes").doc(clienteId).update({
      ...updates,
      fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /**
   * Soft delete client
   * @param {string} clienteId - Client ID
   * @returns {Promise<void>}
   */
  async deleteCliente(clienteId) {
    const db = firebase.firestore();
    await db.collection("clientes").doc(clienteId).update({
      eliminado: true,
      fecha_eliminacion: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
};

// Export to window for global access
window.ClientesService = ClientesService;
