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
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useFonts } from "expo-font";

import { firebaseConfig } from "./firebase.config";
import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";

// Local assets
const homeQrImage = require("./assets/home-qr.png");
const cameraImage = require("./assets/camera.png");
const activeTemporaryImage = require("./assets/chat-icons/active-temporary.png");
const chatBgImage = require("./assets/chat-bg/chat-bg.png");

// Chat icons
const CHAT_ICONS = {
  default: require("./assets/chat-icons/default.png"),
  anonymous: require("./assets/chat-icons/anonymous.png"),
  business: require("./assets/chat-icons/business.png"),
  celebrity: require("./assets/chat-icons/celebrity.png"),
  coffee: require("./assets/chat-icons/coffee.png"),
  family: require("./assets/chat-icons/family.png"),
  flirty: require("./assets/chat-icons/flirty.png"),
  food: require("./assets/chat-icons/food.png"),
  friendship: require("./assets/chat-icons/friendship.png"),
  nightlife: require("./assets/chat-icons/nightlife.png"),
  professional_female: require("./assets/chat-icons/professional_female.png"),
  romantic_female: require("./assets/chat-icons/romantic_female.png"),
  romantic_male: require("./assets/chat-icons/romantic_male.png"),
  school: require("./assets/chat-icons/school.png"),
  sports: require("./assets/chat-icons/sports.png"),
  travel: require("./assets/chat-icons/travel.png"),
};

const CHAT_ICON_LABELS = {
  default: "Default",
  anonymous: "Anonymous",
  business: "Business",
  celebrity: "Celebrity",
  coffee: "Coffee",
  family: "Family",
  flirty: "Flirty",
  food: "Food / Dining",
  friendship: "Friendship",
  nightlife: "Nightlife",
  professional_female: "Professional (F)",
  romantic_female: "Romantic (F)",
  romantic_male: "Romantic (M)",
  school: "School / Study",
  sports: "Sports",
  travel: "Travel",
};

const getIconLabel = (key) => CHAT_ICON_LABELS[key] || key;

// Theme colors
const COLORS = {
  navy: "#0A1A33",
  gold: "#FFC836",
  navySoft: "#101B2D",
  slate: "#485F8C",
  charcoal: "#2B2B2B",
  offWhite: "#F8F4E6",
  textSoft: "#CED4E5",
};

// Extend options (wheel picker)
const EXTEND_OPTIONS = [
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
  { label: "8 hours", minutes: 480 },
  { label: "24 hours", minutes: 1440 },
];

// Key for multi-chat storage
const ACTIVE_SESSIONS_KEY = "activeSessionsV1";

// Small helper: format remaining time label for the active list
function formatRemainingShort(expiresAtMs) {
  if (!expiresAtMs) return "No expiry set";
  const diff = expiresAtMs - Date.now();
  if (diff <= 0) return "Expired";

  const totalMin = Math.floor(diff / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  if (hours > 0) {
    if (mins === 0) return `${hours}h left`;
    return `${hours}h ${mins}m left`;
  }
  return `${totalMin}m left`;
}

// Initialize Firebase (compat)
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

export default function App() {
  // Load fonts
  const [fontsLoaded] = useFonts({
    "Montserrat-Regular": require("./assets/fonts/Montserrat-Regular.ttf"),
    "Montserrat-Bold": require("./assets/fonts/Montserrat-Bold.ttf"),
    "Poppins-Regular": require("./assets/fonts/Poppins-Regular.ttf"),
  });

  const [mode, setMode] = useState("home"); // home | scan | show | connecting | chat | activeList
  const [sessionId, setSessionId] = useState(null);
  const [sessionRole, setSessionRole] = useState(null); // "owner" | "guest" | null
  const [user, setUser] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");

  const messagesUnsub = useRef(null);
  const sessionMetaUnsub = useRef(null);
  const scannerLocked = useRef(false);

  const [permission, requestPermission] = useCameraPermissions();

  // keep a live copy of mode for Firestore listeners
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Local per-device chat name
  const [localChatName, setLocalChatName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // Per-chat icon
  const [chatIconKey, setChatIconKey] = useState("default");
  const [iconPickerVisible, setIconPickerVisible] = useState(false);

  // Expiration countdown (for the currently open chat)
  const [expiresAtMs, setExpiresAtMs] = useState(null);
  const [remainingLabel, setRemainingLabel] = useState("");

  // Extend modal state (wheel picker)
  const [extendModalVisible, setExtendModalVisible] = useState(false);
  const [selectedExtendIndex, setSelectedExtendIndex] = useState(2); // default: 1 hour

  // End-chat confirmation modal
  const [confirmEndVisible, setConfirmEndVisible] = useState(false);

  // Multi-chat: local index of active temporary sessions
  // Each: { id, role, name, iconKey, expiresAtMs, lastReadCount, unreadCount }
  const [activeSessions, setActiveSessions] = useState([]);

  // ---------- AUTH ----------
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      if (u) setUser(u);
      else
        auth
          .signInAnonymously()
          .catch((err) => console.log("AUTH ERR:", err));
    });
    return () => unsub();
  }, []);

  // ---------- CAMERA PERMISSION ----------
  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission]);

  // ---------- LOAD ACTIVE SESSIONS ON BOOT ----------
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ACTIVE_SESSIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const prepared = parsed.map((s) => ({
              id: s.id,
              role: s.role || "owner",
              name: s.name || "Chat",
              iconKey: s.iconKey || "default",
              expiresAtMs: s.expiresAtMs || null,
              lastReadCount: s.lastReadCount || 0,
              unreadCount: s.unreadCount || 0,
            }));
            setActiveSessions(prepared);
          }
        }
      } catch (e) {
        console.warn("Failed to load active sessions index", e);
      }
    })();
  }, []);

  function persistActiveSessions(list) {
    try {
      AsyncStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Failed to persist active sessions", e);
    }
  }

  function addActiveSession(id, role, extra = {}) {
    if (!id) return;
    setActiveSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      const session = {
        id,
        role: role || "owner",
        name: extra.name || "Chat",
        iconKey: extra.iconKey || "default",
        expiresAtMs: extra.expiresAtMs || null,
        lastReadCount: extra.lastReadCount || 0,
        unreadCount: extra.unreadCount || 0,
      };
      const updated = [session, ...filtered];
      persistActiveSessions(updated);
      return updated;
    });
  }

  function updateActiveSession(id, patch = {}) {
    if (!id) return;
    setActiveSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      );
      persistActiveSessions(updated);
      return updated;
    });
  }

  function removeActiveSession(id) {
    if (!id) return;
    setActiveSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      persistActiveSessions(updated);
      return updated;
    });
  }

  // ---------- LOAD LOCAL NAME + ICON WHEN SESSION CHANGES ----------
  useEffect(() => {
    if (!sessionId) {
      setLocalChatName("");
      setChatIconKey("default");
      return;
    }
    loadLocalName(sessionId);
    loadLocalIcon(sessionId);
  }, [sessionId]);

  async function loadLocalName(sid) {
    try {
      const key = `chatName:${sid}`;
      const val = await AsyncStorage.getItem(key);
      const name = val || "Chat";
      setLocalChatName(name);
      updateActiveSession(sid, { name });
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
      updateActiveSession(sid, { name });
    } catch (e) {
      console.warn("Failed to save local name", e);
    }
  }

  async function loadLocalIcon(sid) {
    try {
      const key = `chatIcon:${sid}`;
      const val = await AsyncStorage.getItem(key);
      if (val && CHAT_ICONS[val]) {
        setChatIconKey(val);
        updateActiveSession(sid, { iconKey: val });
      } else {
        setChatIconKey("default");
        updateActiveSession(sid, { iconKey: "default" });
      }
    } catch (e) {
      console.warn("Failed to load local icon", e);
      setChatIconKey("default");
      updateActiveSession(sid, { iconKey: "default" });
    }
  }

  async function saveLocalIcon(sid, iconKey) {
    try {
      const key = `chatIcon:${sid}`;
      await AsyncStorage.setItem(key, iconKey);
      setChatIconKey(iconKey);
      updateActiveSession(sid, { iconKey });
    } catch (e) {
      console.warn("Failed to save local icon", e);
    }
  }

  // ---------- COUNTDOWN LOGIC FOR CURRENT CHAT ----------
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
    setChatIconKey("default");
    setIconPickerVisible(false);
    setExtendModalVisible(false);
    setConfirmEndVisible(false);
    // activeSessions remain (other chats still alive)
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
            removeActiveSession(sid);
            cleanupSession();
            setMode("home");
            return;
          }
          const data = snap.data();
          if (data.deleted) {
            Alert.alert("This chat has ended.");
            removeActiveSession(sid);
            cleanupSession();
            setMode("home");
            return;
          }

          if (data.expiresAt && data.expiresAt.toMillis) {
            const ms = data.expiresAt.toMillis();
            setExpiresAtMs(ms);
            updateActiveSession(sid, { expiresAtMs: ms });
          }

          // Owner always auto-enters chat once connected
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

  // --- SUBSCRIBE MESSAGES (and track unread per-session) ---
  function subscribeMessages(sid) {
    const col = db.collection("sessions").doc(sid).collection("messages");
    if (messagesUnsub.current) messagesUnsub.current();
    messagesUnsub.current = col.orderBy("createdAt", "asc").onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        setMessages(arr);

        // Update unread count for this session
        setActiveSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sid) return s;

            const prevRead = s.lastReadCount || 0;

            if (modeRef.current === "chat") {
              // User is viewing this chat: mark as read
              return {
                ...s,
                lastReadCount: arr.length,
                unreadCount: 0,
              };
            } else {
              // User is away from chat: accumulate unread based on new messages
              const diff = arr.length - prevRead;
              if (diff > 0) {
                const currentUnread = s.unreadCount || 0;
                return {
                  ...s,
                  unreadCount: currentUnread + diff,
                };
              }
              return s;
            }
          })
        );
      }
    );
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
      await saveLocalIcon(sid, "default");

      // Track in local active sessions
      addActiveSession(sid, "owner", {
        name: "Chat",
        iconKey: "default",
        expiresAtMs: expires,
        lastReadCount: 0,
        unreadCount: 0,
      });

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
      scannerLocked.current = false;
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

      let expiresMs;
      if (data.expiresAt && data.expiresAt.toMillis) {
        expiresMs = data.expiresAt.toMillis();
        setExpiresAtMs(expiresMs);
      } else {
        expiresMs = Date.now() + 60 * 60 * 1000;
        setExpiresAtMs(expiresMs);
      }

      await loadLocalName(sid);
      await loadLocalIcon(sid);

      // Track in local active sessions
      addActiveSession(sid, "guest", {
        name: "Chat",
        iconKey: "default",
        expiresAtMs: expiresMs,
        lastReadCount: 0,
        unreadCount: 0,
      });

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

  // --- OPEN EXISTING SESSION FROM ACTIVE LIST ---
  function openExistingSession(session) {
    const { id, role, expiresAtMs: sessExpires } = session || {};
    if (!id || !role) return;

    if (messagesUnsub.current) {
      messagesUnsub.current();
      messagesUnsub.current = null;
    }
    if (sessionMetaUnsub.current) {
      sessionMetaUnsub.current();
      sessionMetaUnsub.current = null;
    }

    setMessages([]);
    setSessionId(id);
    setSessionRole(role);

    loadLocalName(id);
    loadLocalIcon(id);

    if (sessExpires) {
      setExpiresAtMs(sessExpires);
    }

    subscribeMessages(id);
    subscribeSessionMeta(id, role);

    setMode("chat");
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

  // --- END CHAT (real) ---
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
    // Remove from local active list
    removeActiveSession(sessionId);
    cleanupSession();
    setMode("home");
  }

  // --- EXTEND CHAT BY MINUTES (using wheel selection) ---
  async function extendChatByMinutes(minutes) {
    if (!sessionId || !minutes) return;
    try {
      const ref = db.collection("sessions").doc(sessionId);

      const base = Math.max(Date.now(), expiresAtMs || 0);
      const newExpires = base + minutes * 60 * 1000;

      await ref.update({
        expiresAt: new Date(newExpires),
      });
      setExpiresAtMs(newExpires);
      updateActiveSession(sessionId, { expiresAtMs: newExpires });

      const hours = minutes / 60;
      const niceLabel =
        minutes < 60
          ? `${minutes} minutes`
          : `${hours} hour${hours === 1 ? "" : "s"}`;

      Alert.alert("Chat extended", `Chat extended by ${niceLabel}`);
    } catch (err) {
      console.warn("extendChat failed", err);
      Alert.alert("Failed to extend chat");
    }
  }

  // ---------- FONTS LOADING STATE ----------
  if (!fontsLoaded) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={COLORS.gold} />
        <Text
          style={{
            marginTop: 12,
            color: COLORS.offWhite,
            fontFamily: "Poppins-Regular",
          }}
        >
          Loading…
        </Text>
      </SafeAreaView>
    );
  }

  // ---------- SCREENS ----------

  // SCAN SCREEN
  if (mode === "scan") {
    if (!permission) return <Text>Requesting permission…</Text>;
    if (!permission.granted)
      return (
        <SafeAreaView style={styles.container}>
          <Text
            style={{
              color: COLORS.offWhite,
              fontFamily: "Poppins-Regular",
            }}
          >
            No camera permission
          </Text>
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
        <StatusBar style="light" />
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
        <StatusBar style="light" />
        <Text style={styles.codeTitle}>Your Code</Text>

        <View style={styles.qrCard}>
          {sessionId ? (
            <QRCode value={sessionId} size={220} />
          ) : (
            <ActivityIndicator size="large" color={COLORS.gold} />
          )}
        </View>

        <View style={{ marginTop: 24, width: "70%" }}>
          <TouchableOpacity
            style={styles.endButton}
            onPress={() => setConfirmEndVisible(true)}
          >
            <Text style={styles.endButtonText}>End Code</Text>
          </TouchableOpacity>
        </View>

        {/* End-chat confirmation modal (from show screen) */}
        {confirmEndVisible && (
          <View style={styles.modalOverlay}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>End chat?</Text>
              <Text style={styles.confirmText}>
                Are you sure you want to end this chat? Once it is ended, the
                connection will be lost forever.
              </Text>
              <View style={styles.confirmButtonsRow}>
                <TouchableOpacity
                  style={styles.modalSecondary}
                  onPress={() => setConfirmEndVisible(false)}
                >
                  <Text style={styles.modalSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalPrimary}
                  onPress={() => {
                    setConfirmEndVisible(false);
                    endChat();
                  }}
                >
                  <Text style={styles.modalPrimaryText}>End Chat</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // CONNECTING SCREEN
  if (mode === "connecting") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <Text style={styles.titleBig}>Connecting…</Text>
        <ActivityIndicator
          size="large"
          style={{ marginTop: 20 }}
          color={COLORS.gold}
        />
        <Text style={styles.connectingSubtitle}>
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

  // ACTIVE TEMPORARY CHATS LIST SCREEN
  if (mode === "activeList") {
    const now = Date.now();
    const visibleSessions = activeSessions.filter(
      (s) => !s.expiresAtMs || s.expiresAtMs > now
    );

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.activeListHeader}>
          <TouchableOpacity
            style={styles.activeListBackButton}
            onPress={() => setMode("home")}
          >
            <Text style={styles.activeListBackText}>Home</Text>
          </TouchableOpacity>
          <Text style={styles.activeListTitle}>Active Temporary Chats</Text>
        </View>

        {visibleSessions.length === 0 ? (
          <View style={styles.activeListEmptyWrap}>
            <Text style={styles.activeListEmptyText}>
              You don&apos;t have any active temporary chats.
            </Text>
          </View>
        ) : (
          <FlatList
            data={visibleSessions}
            keyExtractor={(item) => item.id}
            style={{ width: "100%", paddingHorizontal: 16 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => {
              const iconSource =
                CHAT_ICONS[item.iconKey] || CHAT_ICONS["default"];
              const unread = item.unreadCount || 0;
              return (
                <TouchableOpacity
                  style={styles.activeListItem}
                  activeOpacity={0.85}
                  onPress={() => openExistingSession(item)}
                >
                  <View style={styles.activeListItemRow}>
                    <Image
                      source={iconSource}
                      style={styles.activeListAvatar}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activeListName}>
                        {item.name || "Chat"}
                      </Text>
                      <Text style={styles.activeListMeta}>
                        {formatRemainingShort(item.expiresAtMs)}
                        {unread > 0 ? ` • ${unread} new` : ""}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </SafeAreaView>
    );
  }

  // CHAT SCREEN
  if (mode === "chat") {
    const avatarSource =
      CHAT_ICONS[chatIconKey] || CHAT_ICONS["default"];

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

        <KeyboardAvoidingView
          style={{ flex: 1, width: "100%" }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.chatWrapper}>
              {/* header + separator */}
              <View style={styles.chatHeader}>
                <Text style={styles.chatHeaderLabel}>Chat</Text>

                <View style={styles.chatHeaderRow}>
                  <View style={styles.chatHeaderLeft}>
                    <TouchableOpacity
                      onPress={() => setIconPickerVisible(true)}
                      activeOpacity={0.8}
                    >
                      <Image
                        source={avatarSource}
                        style={styles.chatAvatar}
                      />
                    </TouchableOpacity>

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

                  {/* Go to Active Chats list (without ending chat) */}
                  <TouchableOpacity
                    style={styles.headerHomeButton}
                    onPress={() => setMode("activeList")}
                  >
                    <Text style={styles.headerHomeButtonText}>Chats</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* separator line */}
              <View style={styles.chatSeparator} />

              {/* Chat background pattern behind messages */}
              <ImageBackground
                source={chatBgImage}
                style={styles.chatBg}
                imageStyle={styles.chatBgImage}
              >
                <FlatList
                  data={messages}
                  keyExtractor={(item) => item.id}
                  style={{ width: "100%", flex: 1, paddingHorizontal: 16 }}
                  contentContainerStyle={{
                    paddingBottom: 8,
                    paddingTop: 8,
                  }}
                  renderItem={({ item }) => {
                    const isMe =
                      item.senderUid === auth.currentUser?.uid;
                    return (
                      <View
                        style={isMe ? styles.chatRight : styles.chatLeft}
                      >
                        <Text
                          style={
                            isMe ? styles.chatRightText : styles.chatLeftText
                          }
                        >
                          {item.text}
                        </Text>
                      </View>
                    );
                  }}
                  keyboardShouldPersistTaps="handled"
                />
              </ImageBackground>

              {/* input + countdown + buttons */}
              <View
                style={{
                  width: "100%",
                  backgroundColor: COLORS.navySoft,
                }}
              >
                <View style={styles.messageRow}>
                  <TextInput
                    style={styles.input}
                    value={messageText}
                    onChangeText={setMessageText}
                    placeholder="Type a message"
                    placeholderTextColor={COLORS.textSoft}
                    multiline
                    textAlignVertical="top"
                    underlineColorAndroid="transparent"
                    scrollEnabled={true}
                    returnKeyType="send"
                    onSubmitEditing={() => {
                      if (Platform.OS === "ios") {
                        sendMessage();
                      }
                    }}
                  />

                  <TouchableOpacity
                    style={styles.sendButton}
                    onPress={sendMessage}
                  >
                    <Text style={styles.sendButtonText}>Send</Text>
                  </TouchableOpacity>
                </View>

                {remainingLabel ? (
                  <View style={styles.countdownPill}>
                    <Text style={styles.countdownText}>{remainingLabel}</Text>
                  </View>
                ) : null}

                <View style={styles.footerButtonsRow}>
                  <TouchableOpacity
                    style={styles.endChatButton}
                    onPress={() => setConfirmEndVisible(true)}
                  >
                    <Text style={styles.endChatText}>End Chat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.extendChatButton}
                    onPress={() => setExtendModalVisible(true)}
                  >
                    <Text style={styles.extendChatText}>Extend Chat</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Edit-name modal (simple overlay) */}
              {editingName && (
                <View style={styles.modalOverlay}>
                  <View style={styles.modalCard}>
                    <Text style={styles.modalTitle}>Edit chat name</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={nameInput}
                      onChangeText={setNameInput}
                      placeholder='e.g. "girl I met at the bar"'
                      placeholderTextColor={COLORS.textSoft}
                    />
                    <View style={styles.modalButtonsRow}>
                      <TouchableOpacity
                        style={styles.modalSecondary}
                        onPress={() => setEditingName(false)}
                      >
                        <Text style={styles.modalSecondaryText}>Cancel</Text>
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
                        <Text style={styles.modalPrimaryText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              {/* Icon picker modal */}
              {iconPickerVisible && (
                <View style={styles.modalOverlay}>
                  <View style={styles.iconPickerCard}>
                    <Text style={styles.modalTitle}>Choose chat icon</Text>
                    <ScrollView contentContainerStyle={styles.iconGrid}>
                      {Object.entries(CHAT_ICONS).map(
                        ([key, source]) => (
                          <TouchableOpacity
                            key={key}
                            style={styles.iconOption}
                            onPress={async () => {
                              if (sessionId) {
                                await saveLocalIcon(sessionId, key);
                              } else {
                                setChatIconKey(key);
                              }
                              setIconPickerVisible(false);
                            }}
                          >
                            <Image
                              source={source}
                              style={styles.iconOptionImage}
                            />
                            <Text style={styles.iconOptionLabel}>
                              {getIconLabel(key)}
                            </Text>
                          </TouchableOpacity>
                        )
                      )}
                    </ScrollView>
                    <TouchableOpacity
                      style={styles.iconPickerClose}
                      onPress={() => setIconPickerVisible(false)}
                    >
                      <Text style={styles.iconPickerCloseText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Extend chat wheel-picker modal */}
              {extendModalVisible && (
                <View style={styles.modalOverlay}>
                  <View style={styles.extendCard}>
                    <Text style={styles.modalTitle}>Extend chat</Text>
                    <Text style={styles.extendSubtitle}>
                      Choose how long you want to keep this chat alive.
                    </Text>

                    <View style={styles.extendWheel}>
                      <ScrollView showsVerticalScrollIndicator={false}>
                        {EXTEND_OPTIONS.map((opt, index) => {
                          const selected =
                            index === selectedExtendIndex;
                          return (
                            <TouchableOpacity
                              key={opt.label}
                              style={[
                                styles.extendOptionRow,
                                selected && styles.extendOptionRowSelected,
                              ]}
                              onPress={() => setSelectedExtendIndex(index)}
                            >
                              <Text
                                style={[
                                  styles.extendOptionText,
                                  selected &&
                                    styles.extendOptionTextSelected,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                      <View style={styles.extendWheelHighlight} />
                    </View>

                    <View style={styles.modalButtonsRow}>
                      <TouchableOpacity
                        style={styles.modalSecondary}
                        onPress={() => setExtendModalVisible(false)}
                      >
                        <Text style={styles.modalSecondaryText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.modalPrimary}
                        onPress={async () => {
                          const option =
                            EXTEND_OPTIONS[selectedExtendIndex];
                          await extendChatByMinutes(option.minutes);
                          setExtendModalVisible(false);
                        }}
                      >
                        <Text style={styles.modalPrimaryText}>
                          Confirm
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              {/* End-chat confirmation modal */}
              {confirmEndVisible && (
                <View style={styles.modalOverlay}>
                  <View style={styles.confirmCard}>
                    <Text style={styles.confirmTitle}>End chat?</Text>
                    <Text style={styles.confirmText}>
                      Are you sure you want to end this chat? Once it is
                      ended, the connection will be lost forever.
                    </Text>
                    <View style={styles.confirmButtonsRow}>
                      <TouchableOpacity
                        style={styles.modalSecondary}
                        onPress={() => setConfirmEndVisible(false)}
                      >
                        <Text style={styles.modalSecondaryText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.modalPrimary}
                        onPress={() => {
                          setConfirmEndVisible(false);
                          endChat();
                        }}
                      >
                        <Text style={styles.modalPrimaryText}>End Chat</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // HOME SCREEN
  const hasActiveChats =
    activeSessions && activeSessions.length > 0;

  const totalUnread = activeSessions.reduce(
    (sum, s) => sum + (s.unreadCount || 0),
    0
  );

  let activeSubtitle = "";
  if (hasActiveChats) {
    if (activeSessions.length === 1) {
      activeSubtitle =
        totalUnread > 0
          ? `You have 1 active chat, ${totalUnread} new message${
              totalUnread === 1 ? "" : "s"
            }.`
          : "You have 1 active chat. No new messages.";
    } else {
      activeSubtitle =
        totalUnread > 0
          ? `You have ${activeSessions.length} active chats, ${totalUnread} new messages.`
          : `You have ${activeSessions.length} active chats. No new messages.`;
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
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

      {/* Active Temporary Chats card (only if there is at least one active session) */}
      {hasActiveChats && (
        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.bigCard}
          onPress={() => setMode("activeList")}
        >
          <View style={styles.cardRow}>
            <Image
              source={activeTemporaryImage}
              style={styles.cardIcon}
            />
            <View style={styles.cardTextBlock}>
              <Text style={styles.cardTitle}>Active Temporary Chats</Text>
              <Text style={styles.cardSubtitle}>{activeSubtitle}</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

// STYLES
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    backgroundColor: COLORS.navy,
  },

  titleBig: {
    fontSize: 40,
    marginTop: 80,
    marginBottom: 30,
    fontFamily: "Montserrat-Bold",
    color: COLORS.offWhite,
  },

  bigCard: {
    width: "88%",
    backgroundColor: COLORS.navySoft,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: "#182640",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 4,
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
    fontFamily: "Montserrat-Bold",
    marginBottom: 4,
    color: COLORS.gold,
  },
  cardSubtitle: {
    fontSize: 14,
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
  },

  // Camera screen
  cameraHeader: {
    alignItems: "center",
    marginTop: 12,
  },
  scanTitle: {
    fontSize: 32,
    fontFamily: "Montserrat-Bold",
    marginBottom: 4,
    color: COLORS.offWhite,
  },
  scanSubtitle: {
    fontSize: 14,
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
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
    borderColor: "#182640",
    overflow: "hidden",
    backgroundColor: COLORS.navySoft,
  },
  cameraFooter: {
    paddingBottom: 24,
    alignItems: "center",
  },

  primaryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: COLORS.gold,
  },
  primaryButtonText: {
    color: COLORS.navy,
    fontFamily: "Montserrat-Bold",
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.gold,
    backgroundColor: "transparent",
  },
  secondaryButtonText: {
    color: COLORS.gold,
    fontFamily: "Montserrat-Bold",
  },

  // show QR
  codeTitle: {
    fontSize: 32,
    fontFamily: "Montserrat-Bold",
    marginTop: 60,
    marginBottom: 24,
    color: COLORS.offWhite,
  },
  qrCard: {
    alignItems: "center",
    justifyContent: "center",
    width: 260,
    height: 260,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#182640",
    backgroundColor: COLORS.navySoft,
  },
  endButton: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: COLORS.gold,
    alignItems: "center",
  },
  endButtonText: {
    color: COLORS.gold,
    fontFamily: "Montserrat-Bold",
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
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  chatHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    justifyContent: "space-between",
  },
  chatHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  chatAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  chatNameWrap: {
    alignItems: "flex-start",
    flex: 1,
  },
  chatNameText: {
    fontSize: 22,
    fontFamily: "Montserrat-Bold",
    color: COLORS.offWhite,
  },
  chatNameSub: {
    fontSize: 12,
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
  },
  headerHomeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#22324C",
    backgroundColor: "transparent",
  },
  headerHomeButtonText: {
    fontFamily: "Poppins-Regular",
    fontSize: 12,
    color: COLORS.textSoft,
  },
  chatSeparator: {
    height: 1,
    backgroundColor: "#182640",
    width: "100%",
  },

  // chat background
  chatBg: {
    flex: 1,
    width: "100%",
  },
  chatBgImage: {
    resizeMode: "repeat",
    opacity: 0.16,
  },

  chatLeft: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.navySoft,
    padding: 10,
    marginVertical: 6,
    borderRadius: 12,
    maxWidth: "80%",
  },
  chatRight: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.gold,
    padding: 10,
    marginVertical: 6,
    borderRadius: 12,
    maxWidth: "80%",
  },
  chatLeftText: {
    fontFamily: "Poppins-Regular",
    color: COLORS.offWhite,
    fontSize: 14,
  },
  chatRightText: {
    fontFamily: "Poppins-Regular",
    color: COLORS.navy,
    fontSize: 14,
  },

  messageRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: "center",
    width: "100%",
    borderTopWidth: 1,
    borderColor: "#182640",
    backgroundColor: COLORS.navySoft,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#22324C",
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginRight: 8,
    borderRadius: 999,
    minHeight: 40,
    maxHeight: 120,
    color: COLORS.offWhite,
    backgroundColor: "#0D1727",
    textAlignVertical: "top",
    includeFontPadding: false,
    fontFamily: "Poppins-Regular",
    fontSize: 14,
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.gold,
  },
  sendButtonText: {
    color: COLORS.navy,
    fontFamily: "Montserrat-Bold",
  },

  countdownPill: {
    alignSelf: "center",
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#182640",
  },
  countdownText: {
    fontSize: 12,
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
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
    borderColor: "#22324C",
    alignItems: "center",
    backgroundColor: COLORS.navySoft,
  },
  extendChatButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.gold,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  endChatText: {
    color: COLORS.offWhite,
    fontFamily: "Montserrat-Bold",
  },
  extendChatText: {
    color: COLORS.gold,
    fontFamily: "Montserrat-Bold",
  },

  connectingSubtitle: {
    marginTop: 16,
    color: COLORS.textSoft,
    fontFamily: "Poppins-Regular",
  },

  // modal shared overlay
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

  // name modal
  modalCard: {
    width: "86%",
    backgroundColor: COLORS.navySoft,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22324C",
  },
  modalTitle: {
    fontSize: 16,
    marginBottom: 8,
    fontFamily: "Montserrat-Bold",
    color: COLORS.offWhite,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#22324C",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    color: COLORS.offWhite,
    backgroundColor: "#0D1727",
    fontFamily: "Poppins-Regular",
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
    borderColor: "#22324C",
    backgroundColor: "transparent",
  },
  modalPrimary: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.gold,
  },
  modalSecondaryText: {
    color: COLORS.offWhite,
    fontFamily: "Poppins-Regular",
  },
  modalPrimaryText: {
    color: COLORS.navy,
    fontFamily: "Montserrat-Bold",
  },

  // icon picker modal
  iconPickerCard: {
    width: "90%",
    maxHeight: "70%",
    backgroundColor: COLORS.navySoft,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22324C",
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 12,
  },
  iconOption: {
    width: "30%",
    alignItems: "center",
    marginBottom: 16,
  },
  iconOptionImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 6,
  },
  iconOptionLabel: {
    fontSize: 11,
    textAlign: "center",
    color: COLORS.offWhite,
    fontFamily: "Poppins-Regular",
  },
  iconPickerClose: {
    marginTop: 8,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#22324C",
  },
  iconPickerCloseText: {
    color: COLORS.textSoft,
    fontFamily: "Poppins-Regular",
  },

  // extend modal
  extendCard: {
    width: "86%",
    backgroundColor: COLORS.navySoft,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22324C",
  },
  extendSubtitle: {
    fontSize: 13,
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
    marginBottom: 12,
  },
  extendWheel: {
    height: 180,
    marginBottom: 14,
    overflow: "hidden",
  },
  extendWheelHighlight: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 36,
    marginTop: -18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  extendOptionRow: {
    paddingVertical: 8,
    alignItems: "center",
  },
  extendOptionRowSelected: {
    backgroundColor: "#182640",
  },
  extendOptionText: {
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
    fontSize: 14,
  },
  extendOptionTextSelected: {
    color: COLORS.gold,
    fontFamily: "Montserrat-Bold",
  },

  // confirm end modal
  confirmCard: {
    width: "86%",
    backgroundColor: COLORS.navySoft,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22324C",
  },
  confirmTitle: {
    fontSize: 18,
    fontFamily: "Montserrat-Bold",
    color: COLORS.offWhite,
    marginBottom: 8,
  },
  confirmText: {
    fontSize: 14,
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
    marginBottom: 16,
  },
  confirmButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  // Active list screen
  activeListHeader: {
    width: "100%",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  activeListBackButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#22324C",
    marginRight: 12,
  },
  activeListBackText: {
    fontFamily: "Poppins-Regular",
    fontSize: 12,
    color: COLORS.textSoft,
  },
  activeListTitle: {
    fontFamily: "Montserrat-Bold",
    fontSize: 20,
    color: COLORS.offWhite,
  },
  activeListEmptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  activeListEmptyText: {
    fontFamily: "Poppins-Regular",
    fontSize: 14,
    color: COLORS.textSoft,
    textAlign: "center",
  },
  activeListItem: {
    backgroundColor: COLORS.navySoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#182640",
  },
  activeListItemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  activeListAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  activeListName: {
    fontFamily: "Montserrat-Bold",
    fontSize: 16,
    color: COLORS.offWhite,
    marginBottom: 2,
  },
  activeListMeta: {
    fontFamily: "Poppins-Regular",
    fontSize: 12,
    color: COLORS.textSoft,
  },
});
