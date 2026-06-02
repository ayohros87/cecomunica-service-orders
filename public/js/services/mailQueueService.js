/**
 * mailQueueService.js — read-only access to mail_queue for the admin panel.
 *
 * Mail_queue document shape (additive — owners are CFs + various pages):
 *   createdAt:  Timestamp   — always stamped by MailService.enqueue
 *   sent_at:    Timestamp?  — stamped by onMailQueued on successful send
 *   error:      string?     — stamped by onMailQueued on failure (message)
 *   to:         string|string[]
 *   subject:    string?
 *   template:   string?     — when using emailRenderer
 *   ... plus payload-specific fields
 *
 * MailService.enqueue is the canonical writer; this service is read-only
 * and used exclusively by admin/salud.html for diagnostics.
 */
const MailQueueService = {

  // Stuck = createdAt older than olderThanMs and no sent_at yet, no error yet.
  async listStuck({ olderThanMs = 60 * 60 * 1000, limit = 50 } = {}) {
    const db = firebase.firestore();
    const cutoff = new Date(Date.now() - olderThanMs);
    // We can't combine != null filters across two fields in a single Firestore
    // query, so we fetch by createdAt threshold and filter client-side. Bounded
    // by limit so cost is predictable.
    const snap = await db.collection('mail_queue')
      .where('createdAt', '<=', cutoff)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => !m.sent_at && !m.error);
  },

  async listFailed({ limit = 50 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('mail_queue')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => !!m.error)
      .slice(0, limit);
  },

  async countRecent({ withinMs = 24 * 60 * 60 * 1000 } = {}) {
    const db = firebase.firestore();
    const cutoff = new Date(Date.now() - withinMs);
    const snap = await db.collection('mail_queue')
      .where('createdAt', '>=', cutoff)
      .get();
    let sent = 0, pending = 0, failed = 0;
    snap.forEach(d => {
      const m = d.data();
      if (m.error) failed++;
      else if (m.sent_at) sent++;
      else pending++;
    });
    return { sent, pending, failed, total: snap.size };
  },

  /**
   * Re-arm a mail_queue doc for retry: clears error + sent_at + status so
   * onMailQueued (now onDocumentWritten) re-processes it. Stamps audit
   * fields so we can tell retries apart from first attempts.
   */
  async retry(docId) {
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    return db.collection('mail_queue').doc(docId).update({
      error:      firebase.firestore.FieldValue.delete(),
      sent_at:    firebase.firestore.FieldValue.delete(),
      status:     firebase.firestore.FieldValue.delete(),
      retried_at: firebase.firestore.FieldValue.serverTimestamp(),
      retried_by: uid,
    });
  },

  /** Retry a batch of failed docs. Returns counts. */
  async retryMany(docIds) {
    const results = { ok: 0, failed: 0 };
    for (const id of docIds) {
      try { await this.retry(id); results.ok++; }
      catch { results.failed++; }
    }
    return results;
  },
};

window.MailQueueService = MailQueueService;
