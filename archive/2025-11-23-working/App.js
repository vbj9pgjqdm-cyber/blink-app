// App.js
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Keyboard,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

import { firebaseConfig } from "./firebase.config";
import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";

// Local assets
const homeQrImage = require("./assets/home-qr.png");
const cameraImage = require("./assets/camera.png");

// Initialize Firebase (compat)
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

export default function App() {
  const [mode, setMode] = useState("home"); // home | scan | show | connecting | chat
  const [sessionId, setSessionId] = useState(null);
  const [sessionRole, setSessionRole] = useState(null); // "owner" | "guest" | null
  const [user, setUser] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");

  const messagesUnsub = useRef(null);
  const sessionMetaUnsub = useRef(null);
  const scannerLocked = useRef(false);

  const [permission, requestPermission] = useCameraPermissions();

  // 🆕 keep a live copy of mode for Firestore listeners
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Local per-device chat name
  const [localChatName, setLocalChatName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // Expiration countdown
  const [expiresAtMs, setExpiresAtMs] = useState(null);
  const [remainingLabel, setRemainingLabel] = useState("");

  // AUTH
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      if (u) setUser(u);
      else auth
        .signInAnonymously()
        .catch((err) => console.log("AUTH ERR:", err));
    });
    return () => unsub();
  }, []);

  // Request camera permission when needed
  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission]);

  // Load local chat name when session changes
  useEffect(() => {
    if (!sessionId) {
      setLocalChatName("");
      return;
    }
    loadLocalName(sessionId);
  }, [sessionId]);

  async function loadLocalName(sid) {
    try {
      const key = `chatName:${sid}`;
      const val = await AsyncStorage.getItem(key);
      setLocalChatName(val || "Chat");
    } catch (e) {
      console.warn("Failed to load local name", e);
      setLocalChatName("Chat");
    }
  }

  async function saveLocalName(sid, name) {
    try {
      const key = `chatName:${sid}`;
      await AsyncStorage.setItem(key, name);
      setLocalChatName(name);
    } catch (e) {
      console.warn("Failed to save local name", e);
    }
  }

  // Countdown logic
  useEffect(() => {
    if (!expiresAtMs) {
      setRemainingLabel("");
      return;
    }

    function updateLabel() {
      const diff = expiresAtMs - Date.now();
      if (diff <= 0) {
        setRemainingLabel("Expires soon");
        return;
      }
      const totalSec = Math.floor(diff / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const mm = mins.toString();
      const ss = secs.toString().padStart(2, "0");
      setRemainingLabel(`${mm}:${ss} remaining`);
    }

    updateLabel();
    const id = setInterval(updateLabel, 1000);
    return () => clearInterval(id);
  }, [expiresAtMs]);

  function cleanupSession() {
    if (messagesUnsub.current) {
      messagesUnsub.current();
      messagesUnsub.current = null;
    }
    if (sessionMetaUnsub.current) {
      sessionMetaUnsub.current();
      sessionMetaUnsub.current = null;
    }
    setMessages([]);
    setSessionId(null);
    setSessionRole(null);
    setExpiresAtMs(null);
    setLocalChatName("");
  }

  // --- SUBSCRIBE TO SESSION META (owner auto-enters chat) ---
  function subscribeSessionMeta(sid, role) {
    if (sessionMetaUnsub.current) sessionMetaUnsub.current();

    sessionMetaUnsub.current = db
      .collection("sessions")
      .doc(sid)
      .onSnapshot(
        (snap) => {
          if (!snap.exists) {
            Alert.alert("Session ended");
            cleanupSession();
            setMode("home");
            return;
          }
          const data = snap.data();
          if (data.deleted) {
            Alert.alert("This chat has ended.");
            cleanupSession();
            setMode("home");
            return;
          }

          if (data.expiresAt && data.expiresAt.toMillis) {
            setExpiresAtMs(data.expiresAt.toMillis());
          }

          // 🆕 Owner always auto-enters chat once connected
          if (role === "owner" && data.connected) {
            if (modeRef.current !== "chat") {
              setMode("chat");
            }
          }
        },
        (err) => {
          console.warn("session meta subscribe error", err);
        }
      );
  }

  // --- SUBSCRIBE MESSAGES ---
  function subscribeMessages(sid) {
    const col = db.collection("sessions").doc(sid).collection("messages");
    if (messagesUnsub.current) messagesUnsub.current();
    messagesUnsub.current = col.orderBy("createdAt", "asc").onSnapshot((snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setMessages(arr);
    });
  }

  // --- CREATE SESSION (owner) ---
  async function startOwnedSession() {
    if (!auth.currentUser) {
      Alert.alert("Please wait", "Signing in…");
      return;
    }
    try {
      const sid = uuidv4();
      const uid = auth.currentUser.uid;
      const ref = db.collection("sessions").doc(sid);
      const expires = Date.now() + 60 * 60 * 1000;

      await ref.set({
        ownerUid: uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(expires),
        connected: false,
        deleted: false,
      });

      setSessionId(sid);
      setSessionRole("owner");
      setExpiresAtMs(expires);
      subscribeMessages(sid);
      subscribeSessionMeta(sid, "owner");
      await saveLocalName(sid, "Chat");

      setMode("show");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (err) {
      console.log("🔥 startOwnedSession error:", err);
      Alert.alert("Error", "Failed to create session.");
    }
  }

  // --- JOIN SESSION (scanner) ---
  async function joinSessionById(rawSid) {
    const sid = (rawSid || "").trim();
    if (!sid || sid.length < 10) {
      Alert.alert("Invalid code", "This QR is not a valid session.");
      setMode("home");
      return;
    }

    setMode("connecting");
    try {
      const ref = db.collection("sessions").doc(sid);
      const snap = await ref.get();

      if (!snap.exists) {
        Alert.alert("Session not found or expired");
        setMode("home");
        return;
      }

      const data = snap.data();
      if (data.deleted) {
        Alert.alert("This session has been closed.");
        setMode("home");
        return;
      }

      await ref.update({
        connected: true,
        joinedUid: auth.currentUser.uid,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      setSessionId(sid);
      setSessionRole("guest");
      subscribeMessages(sid);
      subscribeSessionMeta(sid, "guest");

      if (data.expiresAt && data.expiresAt.toMillis) {
        setExpiresAtMs(data.expiresAt.toMillis());
      } else {
        setExpiresAtMs(Date.now() + 60 * 60 * 1000);
      }

      await loadLocalName(sid);
      setMode("chat");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (err) {
      console.error("Join session failed", err);
      Alert.alert("Failed to join session");
      setMode("home");
    } finally {
      scannerLocked.current = false;
    }
  }

  // --- SEND MESSAGE ---
  async function sendMessage() {
    if (!messageText.trim() || !sessionId) return;

    const col = db.collection("sessions").doc(sessionId).collection("messages");
    const textToSend = messageText.trim();
    setMessageText(""); // clear immediately

    try {
      await col.add({
        text: textToSend,
        senderUid: auth.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("sendMessage error", err);
    }
  }

  // --- END CHAT ---
  async function endChat() {
    if (!sessionId) {
      setMode("home");
      return;
    }
    try {
      const ref = db.collection("sessions").doc(sessionId);
      await ref.update({
        deleted: true,
        deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn("endChat failed", err);
    }
    cleanupSession();
    setMode("home");
  }

  // --- EXTEND CHAT ---
  async function extendChat() {
    if (!sessionId) return;
    try {
      const ref = db.collection("sessions").doc(sessionId);
      const newExpires = Date.now() + 60 * 60 * 1000;
      await ref.update({
        expiresAt: new Date(newExpires),
      });
      setExpiresAtMs(newExpires);
      Alert.alert("Chat extended", "Chat extended by 1 hour");
    } catch (err) {
      console.warn("extendChat failed", err);
      Alert.alert("Failed to extend chat");
    }
  }

  // ---------- SCREENS ----------

  // SCAN SCREEN
  if (mode === "scan") {
    if (!permission) return <Text>Requesting permission…</Text>;
    if (!permission.granted)
      return (
        <SafeAreaView style={styles.container}>
          <Text>No camera permission</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={requestPermission}
          >
            <Text style={styles.primaryButtonText}>Grant</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );

    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.cameraHeader}>
          <Text style={styles.scanTitle}>Scan a Code</Text>
          <Text style={styles.scanSubtitle}>
            Point your camera at their Blink code
          </Text>
        </View>

        <View style={styles.cameraFrameWrapper}>
          <View style={styles.cameraFrame}>
            <CameraView
              style={{ flex: 1, borderRadius: 20, overflow: "hidden" }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (scannerLocked.current) return;
                scannerLocked.current = true;
                joinSessionById(data);
              }}
            />
          </View>
        </View>

        <View style={styles.cameraFooter}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setMode("home")}
          >
            <Text style={styles.secondaryButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // SHOW QR SCREEN
  if (mode === "show") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <Text style={styles.codeTitle}>Your Code</Text>

        <View style={styles.qrCard}>
          {sessionId ? (
            <QRCode value={sessionId} size={220} />
          ) : (
            <ActivityIndicator size="large" />
          )}
        </View>

        <View style={{ marginTop: 24, width: "70%" }}>
          <TouchableOpacity style={styles.endButton} onPress={endChat}>
            <Text style={styles.endButtonText}>End Code</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // CONNECTING SCREEN
  if (mode === "connecting") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <Text style={styles.titleBig}>Connecting…</Text>
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
        <Text style={{ marginTop: 16, color: "#666" }}>
          Establishing a secure chat…
        </Text>
        <View style={{ marginTop: 30 }}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setMode("home")}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // CHAT SCREEN
  if (mode === "chat") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.chatWrapper}>
            {/* header + separator */}
            <View style={styles.chatHeader}>
              <Text style={styles.chatHeaderLabel}>Chat</Text>
              <View style={styles.chatNameWrap}>
                <TouchableOpacity
                  onPress={() => {
                    setNameInput(localChatName || "Chat");
                    setEditingName(true);
                  }}
                >
                  <Text style={styles.chatNameText}>
                    {localChatName || "Chat"}
                  </Text>
                  <Text style={styles.chatNameSub}>(tap to edit)</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* separator line */}
            <View style={styles.chatSeparator} />

            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              style={{ width: "100%", flex: 1, paddingHorizontal: 16 }}
              contentContainerStyle={{ paddingBottom: 8, paddingTop: 8 }}
              renderItem={({ item }) => (
                <View
                  style={
                    item.senderUid === auth.currentUser?.uid
                      ? styles.chatRight
                      : styles.chatLeft
                  }
                >
                  <Text>{item.text}</Text>
                </View>
              )}
              keyboardShouldPersistTaps="handled"
            />

            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"} // 🆕 Android keyboard fix
              keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 80}
              style={{ width: "100%" }}
            >
              <View style={styles.messageRow}>
                <TextInput
                  style={styles.input}
                  value={messageText}
                  onChangeText={setMessageText}
                  placeholder="Type a message"
                  placeholderTextColor="#999"
                  multiline
                  returnKeyType="send"
                  onSubmitEditing={sendMessage}
                />
                <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                  <Text style={styles.sendButtonText}>Send</Text>
                </TouchableOpacity>
              </View>

              {/* countdown pill under input bar */}
              {remainingLabel ? (
                <View style={styles.countdownPill}>
                  <Text style={styles.countdownText}>{remainingLabel}</Text>
                </View>
              ) : null}

              <View style={styles.footerButtonsRow}>
                <TouchableOpacity style={styles.endChatButton} onPress={endChat}>
                  <Text style={styles.endChatText}>End Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.extendChatButton}
                  onPress={extendChat}
                >
                  <Text style={styles.extendChatText}>Extend Chat</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>

            {/* Edit-name modal (simple overlay) */}
            {editingName && (
              <View style={styles.modalOverlay}>
                <View style={styles.modalCard}>
                  <Text style={{ fontSize: 16, marginBottom: 8 }}>
                    Edit chat name
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    value={nameInput}
                    onChangeText={setNameInput}
                    placeholder='e.g. "girl I met at the bar"'
                  />
                  <View style={styles.modalButtonsRow}>
                    <TouchableOpacity
                      style={styles.modalSecondary}
                      onPress={() => setEditingName(false)}
                    >
                      <Text>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.modalPrimary}
                      onPress={async () => {
                        const name = nameInput.trim() || "Chat";
                        if (sessionId) {
                          await saveLocalName(sessionId, name);
                        }
                        setEditingName(false);
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "600" }}>
                        Save
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    );
  }

  // HOME SCREEN
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.titleBig}>Blink</Text>

      {/* Show My Code card */}
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.bigCard}
        onPress={startOwnedSession}
      >
        <View style={styles.cardRow}>
          <Image source={homeQrImage} style={styles.cardIcon} />
          <View style={styles.cardTextBlock}>
            <Text style={styles.cardTitle}>Show My Code</Text>
            <Text style={styles.cardSubtitle}>
              Generate a temporary QR to chat without sharing your number.
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Scan a Code card */}
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.bigCard}
        onPress={() => {
          scannerLocked.current = false;
          setMode("scan");
        }}
      >
        <View style={styles.cardRow}>
          <Image source={cameraImage} style={styles.cardIconCamera} />
          <View style={styles.cardTextBlock}>
            <Text style={styles.cardTitle}>Scan a Code</Text>
            <Text style={styles.cardSubtitle}>
              Scan their Blink code to start a private chat.
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// STYLES
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#fff",
  },

  titleBig: {
    fontSize: 40,
    marginTop: 80,
    marginBottom: 30,
    fontWeight: "700",
  },

  bigCard: {
    width: "88%",
    backgroundColor: "#fff",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: "#e6e6e6",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 2,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardIcon: {
    width: 72,
    height: 72,
    borderRadius: 10,
    marginRight: 16,
    resizeMode: "contain",
  },
  cardIconCamera: {
    width: 80,
    height: 80,
    borderRadius: 16,
    marginRight: 16,
    resizeMode: "contain",
  },
  cardTextBlock: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    color: "#666",
  },

  // Camera screen
  cameraHeader: {
    alignItems: "center",
    marginTop: 12, // was paddingTop; works better with SafeArea
  },
  scanTitle: {
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 4,
  },
  scanSubtitle: {
    fontSize: 14,
    color: "#666",
  },
  cameraFrameWrapper: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraFrame: {
    width: "80%",
    aspectRatio: 3 / 4,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#eee",
    overflow: "hidden",
  },
  cameraFooter: {
    paddingBottom: 24,
    alignItems: "center",
  },

  primaryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: "#111",
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#fff",
  },
  secondaryButtonText: {
    color: "#111",
    fontWeight: "500",
  },

  // show QR
  codeTitle: {
    fontSize: 32,
    fontWeight: "700",
    marginTop: 60,
    marginBottom: 24,
  },
  qrCard: {
    alignItems: "center",
    justifyContent: "center",
    width: 260,
    height: 260,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#eee",
  },
  endButton: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
  },
  endButtonText: {
    color: "#111",
    fontWeight: "600",
  },

  // chat
  chatWrapper: {
    flex: 1,
    width: "100%",
  },
  chatHeader: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  chatHeaderLabel: {
    fontSize: 12,
    color: "#999",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  chatNameWrap: {
    alignItems: "flex-start",
  },
  chatNameText: {
    fontSize: 22,
    fontWeight: "700",
  },
  chatNameSub: {
    fontSize: 12,
    color: "#666",
  },
  chatSeparator: {
    height: 1,
    backgroundColor: "#eee",
    width: "100%",
  },

  chatLeft: {
    alignSelf: "flex-start",
    backgroundColor: "#f1f1f1",
    padding: 10,
    marginVertical: 6,
    borderRadius: 12,
    maxWidth: "80%",
  },
  chatRight: {
    alignSelf: "flex-end",
    backgroundColor: "#d6f6e8",
    padding: 10,
    marginVertical: 6,
    borderRadius: 12,
    maxWidth: "80%",
  },

  messageRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: "flex-end",
    width: "100%",
    borderTopWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#eee",
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 999,
    maxHeight: 100,
    color: "#000",
    backgroundColor: "#fafafa",
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#111",
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600",
  },

  countdownPill: {
    alignSelf: "center",
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#f2f2f2",
  },
  countdownText: {
    fontSize: 12,
    color: "#555",
  },

  footerButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 18,
    gap: 12,
  },
  endChatButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  extendChatButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  endChatText: {
    color: "#111",
    fontWeight: "600",
  },
  extendChatText: {
    color: "#111",
    fontWeight: "600",
  },

  // modal
  modalOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: "86%",
    backgroundColor: "#fff",
    padding: 18,
    borderRadius: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  modalButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  modalSecondary: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  modalPrimary: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#111",
  },
});
