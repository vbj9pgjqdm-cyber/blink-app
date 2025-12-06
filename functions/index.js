// Firebase Functions v2 (correct syntax)
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// 🔥 Trigger: When a new message is created
exports.sendNotificationOnNewMessage = onDocumentCreated(
  "sessions/{sessionId}/messages/{messageId}",
  async (event) => {
    const message = event.data.data();
    const sessionId = event.params.sessionId;

    if (!message || !sessionId) return;

    const sessionSnap = await db.collection("sessions").doc(sessionId).get();
    if (!sessionSnap.exists) return;

    const sessionData = sessionSnap.data();

    const senderUid = message.senderUid;
    const text = message.text || "";

    // Determine who the receiver is
    let receiverRole =
      sessionData.ownerUid === senderUid ? "guest" : "owner";

    // Lookup Expo push token
    const pushTokens = sessionData.pushTokens || {};
    const expoToken =
    pushTokens[`android_${receiverRole}`] || null;

    if (!expoToken) {
      console.log("❌ No Expo push token for receiver");
      return;
    }

    // Personalized name
    const senderName =
      senderUid === sessionData.ownerUid
        ? sessionData.names?.owner
        : sessionData.names?.guest;

    const cleanName = senderName || "New Message";

    // Build notification
    const payload = {
      notification: {
        title: cleanName,
        body: text.substring(0, 80),
      },
      data: {
        sessionId,
        sender: cleanName,
      },
      token: expoToken,
    };

    try {
      await getMessaging().send(payload);
      console.log("✅ Notification sent:", payload);
    } catch (error) {
      console.error("🔥 Error sending notification:", error);
    }
  }
);
