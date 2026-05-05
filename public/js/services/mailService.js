// Thin wrapper around the mail_queue collection.
// All pages use MailService.enqueue() instead of db.collection("mail_queue").add().
// Document shape varies per caller; createdAt is always stamped here.
const MailService = {
  async enqueue(doc) {
    const db = firebase.firestore();
    return db.collection('mail_queue').add({
      ...doc,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
};

window.MailService = MailService;
