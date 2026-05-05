// Thin auth helpers — depends on firebase-init.js having run first
// Provides synchronous role access and convenience predicates
window.AUTH = {
  // Role of the currently signed-in user (set by firebase-init.js)
  getRole() {
    return window.userRole || null;
  },

  // Current Firebase Auth user object
  getUser() {
    return firebase.auth().currentUser;
  },

  // True if current user has exactly this role
  is(rol) {
    return window.userRole === rol;
  },

  // True if current user has any of the given roles
  isAny(...roles) {
    return roles.includes(window.userRole);
  },

  // Entry point — guards the page and passes role to callback
  // Delegates to verificarAccesoYAplicarVisibilidad from firebase-init.js
  requireAccess(callback) {
    return window.verificarAccesoYAplicarVisibilidad(callback);
  }
};
