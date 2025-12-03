const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

exports.onSessionDeleted = functions.firestore
  .document("sessions/{sessionId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const sessionId = context.params.sessionId;
    if (!before.deleted && after.deleted) {
      const messagesRef = db.collection("sessions").doc(sessionId).collection("messages");
      const snapshot = await messagesRef.get();
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      await db.collection("sessions").doc(sessionId).delete();
    }
    return null;
});

exports.scheduledCleanup = functions.pubsub.schedule("every 1 hours").onRun(async (context) => {
  const now = admin.firestore.Timestamp.now();
  const sessionsRef = db.collection("sessions");
  const q = sessionsRef.where("expiresAt", "<=", now).limit(500);
  const snapshot = await q.get();
  const batch = db.batch();
  snapshot.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return null;
});
