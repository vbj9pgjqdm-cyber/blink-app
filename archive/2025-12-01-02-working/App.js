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

// === ASSETS ===
const homeQrImage = require("./assets/home-qr.png");
const cameraImage = require("./assets/camera.png");
const activeTemporaryImage = require("./assets/chat-icons/active-temporary.png");
const chatBgImage = require("./assets/chat-bg/chat-bg.png");
const homeBgImage = require("./assets/home-bg/home-bg.png");
const permanentChatImage = require("./assets/chat-icons/permanent-chat.png");
const permanentPadlockImage = require("./assets/chat-icons/permanent-padlock.png");
const keyboardIcon = require("./assets/chat-icons/keyboard.png");

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

// Storage keys
const ACTIVE_SESSIONS_KEY = "activeSessionsV2"; // temporary chats
const PERMANENT_SESSIONS_KEY = "permanentSessionsV1"; // permanent chats

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

  // Modes:
  // home | scan | show | connecting | chat | activeList (temporary) | permanentList
  const [mode, setMode] = useState("home");
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const [sessionId, setSessionId] = useState(null);
  const [sessionRole, setSessionRole] = useState(null); // "owner" | "guest" | null
  const [user, setUser] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const messagesListRef = useRef(null);

  const messagesUnsub = useRef(null);
  const sessionMetaUnsub = useRef(null);
  const scannerLocked = useRef(false);
  const focusTimeoutRef = useRef(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraAutoFocus, setCameraAutoFocus] = useState("on");

  // Local per-device chat name
  const [localChatName, setLocalChatName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // Per-chat icon
  const [chatIconKey, setChatIconKey] = useState("default");
  const [iconPickerVisible, setIconPickerVisible] = useState(false);

  // Expiration countdown (for the currently open temporary chat)
  const [expiresAtMs, setExpiresAtMs] = useState(null);
  const [remainingLabel, setRemainingLabel] = useState("");

  // Extend modal state (wheel picker)
  const [extendModalVisible, setExtendModalVisible] = useState(false);
  const [selectedExtendIndex, setSelectedExtendIndex] = useState(2); // default: 1 hour

  // End-chat confirmation modal (temporary chat)
  const [confirmEndVisible, setConfirmEndVisible] = useState(false);

  // Permanent / closed state
  const [isPermanent, setIsPermanent] = useState(false);
  const [isPermanentClosed, setIsPermanentClosed] = useState(false);

  // Permanent chat request (incoming)
  const [incomingPermanentPrompt, setIncomingPermanentPrompt] =
    useState(false);

  // Multi-chat: local index of active temporary sessions
  // Each: { id, role, name, iconKey, expiresAtMs, lastReadCount, unreadCount, lastMessage }
  const [activeTemporary, setActiveTemporary] = useState([]);

  // Permanent chats: { id, role, name, iconKey, closed, lastReadCount, unreadCount, lastMessage }
  const [permanentChats, setPermanentChats] = useState([]);

  // Cleanup camera focus timeout on unmount
  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
      }
    };
  }, []);

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

  // ---------- LOAD TEMPORARY CHATS ON BOOT ----------
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
              lastMessage: s.lastMessage || "",
            }));
            setActiveTemporary(prepared);
          }
        }
      } catch (e) {
        console.warn("Failed to load temporary sessions", e);
      }
    })();
  }, []);

  // ---------- LOAD PERMANENT CHATS ON BOOT ----------
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PERMANENT_SESSIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const prepared = parsed.map((s) => ({
              id: s.id,
              role: s.role || "owner",
              name: s.name || "Chat",
              iconKey: s.iconKey || "default",
              closed: !!s.closed,
              lastReadCount: s.lastReadCount || 0,
              unreadCount: s.unreadCount || 0,
              lastMessage: s.lastMessage || "",
            }));
            setPermanentChats(prepared);
          }
        }
      } catch (e) {
        console.warn("Failed to load permanent chats", e);
      }
    })();
  }, []);

  function persistTemporary(list) {
    try {
      AsyncStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Failed to persist temporary sessions", e);
    }
  }

  function persistPermanent(list) {
    try {
      AsyncStorage.setItem(PERMANENT_SESSIONS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Failed to persist permanent chats", e);
    }
  }

  // ---------- TEMPORARY CHAT HELPERS ----------
  function addTemporaryChat(id, role, extra = {}) {
    if (!id) return;
    setActiveTemporary((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      const session = {
        id,
        role: role || "owner",
        name: extra.name || "Chat",
        iconKey: extra.iconKey || "default",
        expiresAtMs: extra.expiresAtMs || null,
        lastReadCount: extra.lastReadCount || 0,
        unreadCount: extra.unreadCount || 0,
        lastMessage: extra.lastMessage || "",
      };
      const updated = [session, ...filtered];
      persistTemporary(updated);
      return updated;
    });
  }

  function updateTemporaryChat(id, patch = {}) {
    if (!id) return;
    setActiveTemporary((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      );
      persistTemporary(updated);
      return updated;
    });
  }

  function removeTemporaryChat(id) {
    if (!id) return;
    setActiveTemporary((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      persistTemporary(updated);
      return updated;
    });
  }

  // ---------- PERMANENT CHAT HELPERS ----------
  function addPermanentChat(id, role, extra = {}) {
    if (!id) return;
    setPermanentChats((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      const item = {
        id,
        role: role || "owner",
        name: extra.name || "Chat",
        iconKey: extra.iconKey || "default",
        closed: !!extra.closed,
        lastReadCount: extra.lastReadCount || 0,
        unreadCount: extra.unreadCount || 0,
        lastMessage: extra.lastMessage || "",
      };
      const updated = [item, ...filtered];
      persistPermanent(updated);
      return updated;
    });
  }

  function updatePermanentChat(id, patch = {}) {
    if (!id) return;
    setPermanentChats((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      );
      persistPermanent(updated);
      return updated;
    });
  }

  function removePermanentChat(id) {
    if (!id) return;
    setPermanentChats((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      persistPermanent(updated);
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
      updateTemporaryChat(sid, { name });
      updatePermanentChat(sid, { name });
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
      updateTemporaryChat(sid, { name });
      updatePermanentChat(sid, { name });
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
        updateTemporaryChat(sid, { iconKey: val });
        updatePermanentChat(sid, { iconKey: val });
      } else {
        setChatIconKey("default");
        updateTemporaryChat(sid, { iconKey: "default" });
        updatePermanentChat(sid, { iconKey: "default" });
      }
    } catch (e) {
      console.warn("Failed to load local icon", e);
      setChatIconKey("default");
    }
  }

  async function saveLocalIcon(sid, iconKey) {
    try {
      const key = `chatIcon:${sid}`;
      await AsyncStorage.setItem(key, iconKey);
      setChatIconKey(iconKey);
      updateTemporaryChat(sid, { iconKey });
      updatePermanentChat(sid, { iconKey });
    } catch (e) {
      console.warn("Failed to save local icon", e);
    }
  }

  // ---------- COUNTDOWN LOGIC FOR CURRENT TEMPORARY CHAT ----------
  useEffect(() => {
    if (isPermanent || !expiresAtMs) {
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
  }, [expiresAtMs, isPermanent]);

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
    setIsPermanent(false);
    setIsPermanentClosed(false);
    setIncomingPermanentPrompt(false);
  }

  // --- SUBSCRIBE TO SESSION META ---
  function subscribeSessionMeta(sid, role) {
    if (sessionMetaUnsub.current) sessionMetaUnsub.current();

    sessionMetaUnsub.current = db
      .collection("sessions")
      .doc(sid)
      .onSnapshot(
        (snap) => {
          if (!snap.exists) {
            // Session fully gone
            removeTemporaryChat(sid);
            removePermanentChat(sid);
            if (sessionId === sid) {
              cleanupSession();
              setMode("home");
              Alert.alert("Chat ended", "This chat is no longer available.");
            }
            return;
          }

          const data = snap.data();

          // Temporary chat deleted
          if (!data.permanentAccepted && data.deleted) {
            removeTemporaryChat(sid);
            if (sessionId === sid && !isPermanent) {
              cleanupSession();
              setMode("home");
              Alert.alert("Chat ended", "This temporary chat has ended.");
            }
          }

          // Owner auto-enters chat once connected
          if (role === "owner" && data.connected) {
            if (modeRef.current !== "chat") {
              setMode("chat");
            }
          }

          // Temporary expiry timestamp
          if (
            !data.permanentAccepted &&
            data.expiresAt &&
            data.expiresAt.toMillis
          ) {
            const ms = data.expiresAt.toMillis();
            setExpiresAtMs(ms);
            updateTemporaryChat(sid, { expiresAtMs: ms });
          }

          // Permanent accepted
          if (data.permanentAccepted) {
            if (!isPermanent) {
              setIsPermanent(true);
              setExpiresAtMs(null);
            }
            addPermanentChat(sid, role, {
              name: localChatName || "Chat",
              iconKey: chatIconKey,
            });
            removeTemporaryChat(sid);
          }

          // Permanent closed (someone deleted from their side)
          if (data.permanentClosed) {
            setIsPermanentClosed(true);
          }

          // Incoming permanent request
          if (
            data.permanentRequest &&
            data.permanentRequestSenderUid &&
            data.permanentRequestSenderUid !== auth.currentUser?.uid
          ) {
            setIncomingPermanentPrompt(true);
          } else {
            setIncomingPermanentPrompt(false);
          }
        },
        (err) => {
          console.warn("session meta subscribe error", err);
        }
      );
  }

  // --- SUBSCRIBE MESSAGES (and track unread for both lists) ---
  function subscribeMessages(sid) {
    const col = db.collection("sessions").doc(sid).collection("messages");
    if (messagesUnsub.current) messagesUnsub.current();

    messagesUnsub.current = col.orderBy("createdAt", "asc").onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        setMessages(arr);

        const lastText = arr.length ? arr[arr.length - 1].text : "";

        // TEMPORARY list
        setActiveTemporary((prev) => {
          const updated = prev.map((s) => {
            if (s.id !== sid) return s;
            const prevRead = s.lastReadCount || 0;

            // Viewing this temp chat
            if (
              modeRef.current === "chat" &&
              sessionId === sid &&
              !isPermanent
            ) {
              return {
                ...s,
                lastMessage: lastText,
                lastReadCount: arr.length,
                unreadCount: 0,
              };
            }

            const diff = arr.length - prevRead;
            if (diff > 0) {
              return {
                ...s,
                lastMessage: lastText,
                unreadCount: (s.unreadCount || 0) + diff,
              };
            }
            return { ...s, lastMessage: lastText };
          });
          persistTemporary(updated);
          return updated;
        });

        // PERMANENT list
        setPermanentChats((prev) => {
          const updated = prev.map((s) => {
            if (s.id !== sid) return s;
            const prevRead = s.lastReadCount || 0;

            if (
              modeRef.current === "chat" &&
              sessionId === sid &&
              isPermanent
            ) {
              return {
                ...s,
                lastMessage: lastText,
                lastReadCount: arr.length,
                unreadCount: 0,
              };
            }

            const diff = arr.length - prevRead;
            if (diff > 0) {
              return {
                ...s,
                lastMessage: lastText,
                unreadCount: (s.unreadCount || 0) + diff,
              };
            }
            return { ...s, lastMessage: lastText };
          });
          persistPermanent(updated);
          return updated;
        });
      }
    );
  }

  // --- CREATE TEMPORARY SESSION (owner) ---
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
        permanentAccepted: false,
        permanentRequest: false,
        permanentRequestSenderUid: null,
        permanentClosed: false,
        permanentClosedBy: null,
      });

      setSessionId(sid);
      setSessionRole("owner");
      setExpiresAtMs(expires);
      setIsPermanent(false);
      setIsPermanentClosed(false);

      subscribeMessages(sid);
      subscribeSessionMeta(sid, "owner");
      await saveLocalName(sid, "Chat");
      await saveLocalIcon(sid, "default");

      addTemporaryChat(sid, "owner", {
        name: "Chat",
        iconKey: "default",
        expiresAtMs: expires,
        lastReadCount: 0,
        unreadCount: 0,
        lastMessage: "",
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
      if (data.deleted && !data.permanentAccepted) {
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
      setIsPermanent(!!data.permanentAccepted);
      setIsPermanentClosed(!!data.permanentClosed);

      subscribeMessages(sid);
      subscribeSessionMeta(sid, "guest");

      if (!data.permanentAccepted) {
        let expiresMs;
        if (data.expiresAt && data.expiresAt.toMillis) {
          expiresMs = data.expiresAt.toMillis();
        } else {
          expiresMs = Date.now() + 60 * 60 * 1000;
        }
        setExpiresAtMs(expiresMs);

        addTemporaryChat(sid, "guest", {
          name: "Chat",
          iconKey: "default",
          expiresAtMs: expiresMs,
          lastReadCount: 0,
          unreadCount: 0,
          lastMessage: "",
        });
      } else {
        addPermanentChat(sid, "guest", {
          name: "Chat",
          iconKey: "default",
          closed: !!data.permanentClosed,
          lastReadCount: 0,
          unreadCount: 0,
          lastMessage: "",
        });
      }

      await loadLocalName(sid);
      await loadLocalIcon(sid);

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

  // --- OPEN EXISTING TEMPORARY SESSION FROM ACTIVE LIST ---
  function openTemporarySession(session) {
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
    setIsPermanent(false);
    setIsPermanentClosed(false);

    loadLocalName(id);
    loadLocalIcon(id);
    if (sessExpires) setExpiresAtMs(sessExpires);
    else setExpiresAtMs(null);

    subscribeMessages(id);
    subscribeSessionMeta(id, role);

    setMode("chat");
  }

  // --- OPEN EXISTING PERMANENT SESSION FROM PERMANENT LIST ---
  function openPermanentSession(session) {
    const { id, role, closed } = session || {};
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
    setIsPermanent(true);
    setIsPermanentClosed(!!closed);
    setExpiresAtMs(null);

    loadLocalName(id);
    loadLocalIcon(id);

    subscribeMessages(id);
    subscribeSessionMeta(id, role);

    setMode("chat");
  }

  // --- SEND MESSAGE ---
  async function sendMessage() {
    if (!messageText.trim() || !sessionId) return;

    if (isPermanent && isPermanentClosed) {
      Alert.alert(
        "Chat closed",
        "This chat is no longer available for new messages."
      );
      return;
    }

    const col = db.collection("sessions").doc(sessionId).collection("messages");
    const textToSend = messageText.trim();
    setMessageText("");

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

  // --- END TEMPORARY CHAT (real) ---
  async function endChat() {
    if (!sessionId) {
      setMode("home");
      return;
    }

    if (isPermanent) {
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
    removeTemporaryChat(sessionId);
    cleanupSession();
    setMode("home");
  }

  // --- DELETE PERMANENT CHAT FROM PERMANENT LIST ---
  async function deletePermanentFromList(session) {
    if (!session?.id) return;
    const sid = session.id;

    try {
      await db
        .collection("sessions")
        .doc(sid)
        .update({
          permanentClosed: true,
          permanentClosedBy: auth.currentUser?.uid || null,
        });
    } catch (e) {
      console.warn("Failed to mark permanentClosed", e);
    }

    removePermanentChat(sid);

    if (sessionId === sid) {
      setIsPermanentClosed(true);
    }
  }

  // --- EXTEND TEMPORARY CHAT BY MINUTES ---
  async function extendChatByMinutes(minutes) {
    if (!sessionId || !minutes || isPermanent) return;
    try {
      const ref = db.collection("sessions").doc(sessionId);

      const base = Math.max(Date.now(), expiresAtMs || 0);
      const newExpires = base + minutes * 60 * 1000;

      await ref.update({
        expiresAt: new Date(newExpires),
      });
      setExpiresAtMs(newExpires);
      updateTemporaryChat(sessionId, { expiresAtMs: newExpires });

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

  // --- SEND PERMANENT CHAT REQUEST ---
  async function sendPermanentRequest() {
    if (!sessionId || isPermanent) return;
    try {
      await db
        .collection("sessions")
        .doc(sessionId)
        .update({
          permanentRequest: true,
          permanentRequestSenderUid: auth.currentUser?.uid || null,
        });
      Alert.alert(
        "Permanent chat request sent",
        "They’ll be asked if they want to switch to a permanent chat."
      );
    } catch (e) {
      console.warn("sendPermanentRequest error", e);
      Alert.alert("Error", "Failed to send permanent chat request.");
    }
  }

  // --- ACCEPT PERMANENT REQUEST ---
  async function acceptPermanent() {
    if (!sessionId) return;
    try {
      await db
        .collection("sessions")
        .doc(sessionId)
        .update({
          permanentAccepted: true,
          permanentRequest: false,
          permanentRequestSenderUid: null,
          expiresAt: null,
        });

      removeTemporaryChat(sessionId);
      addPermanentChat(sessionId, sessionRole || "owner", {
        name: localChatName || "Chat",
        iconKey: chatIconKey,
        closed: false,
      });

      setIsPermanent(true);
      setExpiresAtMs(null);
      setIncomingPermanentPrompt(false);
    } catch (e) {
      console.warn("acceptPermanent error", e);
      Alert.alert("Error", "Failed to accept permanent chat request.");
    }
  }

  // --- DECLINE PERMANENT REQUEST ---
  async function declinePermanent() {
    if (!sessionId) return;
    try {
      await db
        .collection("sessions")
        .doc(sessionId)
        .update({
          permanentRequest: false,
          permanentRequestSenderUid: null,
        });
    } catch (e) {
      console.warn("declinePermanent error", e);
    }
    setIncomingPermanentPrompt(false);
  }

  // --- TAP TO FOCUS HANDLER FOR SCAN SCREEN ---
  function handleScanFocusTap() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Nudge autofocus by toggling off/on quickly
    setCameraAutoFocus("off");
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
    }
    focusTimeoutRef.current = setTimeout(() => {
      setCameraAutoFocus("on");
    }, 120);
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
          <StatusBar style="light" />
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
        <ImageBackground
          source={homeBgImage}
          style={styles.listBg}
          imageStyle={styles.homeBgImage}
        >
          <View style={styles.cameraHeader}>
            <Text style={styles.scanTitle}>Scan a Code</Text>
            <Text style={styles.scanSubtitle}>
              Point your camera at their Blink code
            </Text>
          </View>

          <View style={styles.cameraFrameWrapper}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleScanFocusTap}
              style={styles.cameraTapArea}
            >
              <View style={styles.cameraFrame}>
                <CameraView
                  style={{ flex: 1, borderRadius: 20, overflow: "hidden" }}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  autoFocus={cameraAutoFocus}
                  onBarcodeScanned={({ data }) => {
                    if (scannerLocked.current) return;
                    scannerLocked.current = true;
                    joinSessionById(data);
                  }}
                />

                <View style={styles.cameraHintWrap}>
                  <Text style={styles.cameraHintText}>Tap to focus</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.cameraFooter}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setMode("home")}
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // SHOW QR SCREEN
  if (mode === "show") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <ImageBackground
          source={homeBgImage}
          style={styles.listBg}
          imageStyle={styles.homeBgImage}
        >
          <Text style={styles.codeTitle}>Your Code</Text>

          <View style={styles.qrCard}>
            {sessionId ? (
              <QRCode value={sessionId} size={220} />
            ) : (
              <ActivityIndicator size="large" color={COLORS.gold} />
            )}
          </View>

          <View
            style={{ marginTop: 24, width: "70%", alignSelf: "center" }}
          >
            <TouchableOpacity
              style={styles.endButton}
              onPress={async () => {
                await endChat();
                setMode("home");
              }}
            >
              <Text style={styles.endButtonText}>End Code</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // CONNECTING SCREEN
  if (mode === "connecting") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <ImageBackground
          source={homeBgImage}
          style={styles.listBg}
          imageStyle={styles.homeBgImage}
        >
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
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // ACTIVE TEMPORARY CHATS LIST SCREEN
  if (mode === "activeList") {
    const now = Date.now();
    const visibleSessions = activeTemporary.filter(
      (s) => !s.expiresAtMs || s.expiresAtMs > now
    );

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <ImageBackground
          source={homeBgImage}
          style={styles.listBg}
          imageStyle={styles.homeBgImage}
        >
          <View style={styles.activeListHeader}>
            <TouchableOpacity
              style={styles.activeListBackButton}
              onPress={() => setMode("home")}
            >
              <Text style={styles.activeListBackText}>Home</Text>
            </TouchableOpacity>
            <Text style={styles.activeListTitle}>Temporary Chats</Text>
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
                    onPress={() => openTemporarySession(item)}
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
                        {item.lastMessage ? (
                          <Text
                            style={styles.activeListMeta}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {item.lastMessage}
                            {unread > 0 ? ` • ${unread} new` : ""}
                          </Text>
                        ) : (
                          <Text style={styles.activeListMeta}>
                            {formatRemainingShort(item.expiresAtMs)}
                            {unread > 0 ? ` • ${unread} new` : ""}
                          </Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // PERMANENT CHATS LIST SCREEN
  if (mode === "permanentList") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <ImageBackground
          source={homeBgImage}
          style={styles.listBg}
          imageStyle={styles.homeBgImage}
        >
          <View style={styles.activeListHeader}>
            <TouchableOpacity
              style={styles.activeListBackButton}
              onPress={() => setMode("home")}
            >
              <Text style={styles.activeListBackText}>Home</Text>
            </TouchableOpacity>
            <Text style={styles.activeListTitle}>Permanent Chats</Text>
          </View>

          {permanentChats.length === 0 ? (
            <View style={styles.activeListEmptyWrap}>
              <Text style={styles.activeListEmptyText}>
                You don&apos;t have any permanent chats yet.
              </Text>
            </View>
          ) : (
            <FlatList
              data={permanentChats}
              keyExtractor={(item) => item.id}
              style={{ width: "100%", paddingHorizontal: 16 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => {
                const iconSource =
                  CHAT_ICONS[item.iconKey] || CHAT_ICONS["default"];
                const unread = item.unreadCount || 0;
                return (
                  <View style={styles.permanentListItem}>
                    <TouchableOpacity
                      style={styles.permanentListPress}
                      activeOpacity={0.85}
                      onPress={() => openPermanentSession(item)}
                    >
                      <View style={styles.activeListItemRow}>
                        <Image
                          source={iconSource}
                          style={styles.activeListAvatar}
                        />
                        <View style={{ flex: 1 }}>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                            }}
                          >
                            <Text style={styles.activeListName}>
                              {item.name || "Chat"}
                            </Text>
                            <Image
                              source={permanentPadlockImage}
                              style={styles.permanentPadlockIcon}
                            />
                          </View>
                          <Text
                            style={styles.activeListMeta}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {item.lastMessage || "No messages yet."}
                            {unread > 0 ? ` • ${unread} new` : ""}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.permanentDeleteButton}
                      onPress={() => {
                        Alert.alert(
                          "Delete permanent chat?",
                          "This will close the chat for both sides. You will no longer see it in your permanent list.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => deletePermanentFromList(item),
                            },
                          ]
                        );
                      }}
                    >
                      <Text style={styles.permanentDeleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // CHAT SCREEN
  if (mode === "chat") {
    const avatarSource =
      CHAT_ICONS[chatIconKey] || CHAT_ICONS["default"];
    const chatReadOnly = isPermanent && isPermanentClosed;

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

        <KeyboardAvoidingView
          style={{ flex: 1, width: "100%" }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.chatWrapper}>
              {/* header + separator */}
              <View style={styles.chatHeader}>
                <Text style={styles.chatHeaderLabel}>
                  {isPermanent ? "PERMANENT CHAT" : "TEMPORARY CHAT"}
                </Text>

                <View style={styles.chatHeaderRow}>
                  {/* LEFT: Home */}
                  <TouchableOpacity
                    style={styles.headerHomeButton}
                    onPress={() => {
                      setMode("home");
                    }}
                  >
                    <Text style={styles.headerHomeButtonText}>Home</Text>
                  </TouchableOpacity>

                  {/* CENTER: avatar + name */}
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

                    <TouchableOpacity
                      style={styles.chatNameWrap}
                      onPress={() => {
                        setNameInput(localChatName || "Chat");
                        setEditingName(true);
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <Text style={styles.chatNameText}>
                          {localChatName || "Chat"}
                        </Text>
                        {isPermanent && (
                          <Image
                            source={permanentPadlockImage}
                            style={{ width: 16, height: 16, marginLeft: 6 }}
                          />
                        )}
                      </View>
                      {!isPermanent && (
                        <Text style={styles.chatNameSub}>(tap to edit)</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* RIGHT: Chats list */}
                  <TouchableOpacity
                    style={styles.headerHomeButton}
                    onPress={() => {
                      if (isPermanent) setMode("permanentList");
                      else setMode("activeList");
                    }}
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
                {chatReadOnly && (
                  <View style={styles.readOnlyBanner}>
                    <Text style={styles.readOnlyBannerText}>
                      This chat is no longer available. You can still view past
                      messages, but can&apos;t send new ones.
                    </Text>
                  </View>
                )}

                <FlatList
                  ref={messagesListRef}
                  data={messages}
                  keyExtractor={(item) => item.id}
                  style={{ width: "100%", flex: 1, paddingHorizontal: 16 }}
                  contentContainerStyle={{
                    paddingBottom: 12,
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
                  onContentSizeChange={() =>
                    messagesListRef.current?.scrollToEnd({ animated: true })
                  }
                  onLayout={() =>
                    messagesListRef.current?.scrollToEnd({ animated: false })
                  }
                />
              </ImageBackground>

              {/* input + countdown + buttons */}
              {!chatReadOnly && (
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
                      placeholder={
                        isPermanent
                          ? "Message (permanent chat)"
                          : "Type a message"
                      }
                      placeholderTextColor={COLORS.textSoft}
                      multiline={false}
                      textAlignVertical="center"
                      underlineColorAndroid="transparent"
                      returnKeyType="send"
                      blurOnSubmit={false}
                      onSubmitEditing={sendMessage}
                    />

                    <TouchableOpacity
                      style={styles.sendButton}
                      onPress={sendMessage}
                    >
                      <Text style={styles.sendButtonText}>Send</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.keyboardButton}
                      onPress={Keyboard.dismiss}
                    >
                      <Image
                        source={keyboardIcon}
                        style={styles.keyboardIcon}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Temporary countdown */}
                  {!isPermanent && remainingLabel ? (
                    <View style={styles.countdownPill}>
                      <Text style={styles.countdownText}>
                        {remainingLabel}
                      </Text>
                    </View>
                  ) : null}

                  {/* Permanent Chat Request button (TEMPORARY only) */}
                  {!isPermanent && (
                    <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
                      <TouchableOpacity
                        style={styles.permanentRequestButton}
                        onPress={sendPermanentRequest}
                      >
                        <Text style={styles.permanentRequestText}>
                          Request Permanent Chat
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Bottom buttons: only for temporary chats */}
                  {!isPermanent && (
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
                        <Text style={styles.extendChatText}>
                          Extend Chat
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              {/* Edit-name modal */}
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
              {extendModalVisible && !isPermanent && (
                <View style={styles.modalOverlay}>
                  <View style={styles.extendCard}>
                    <Text style={styles.modalTitle}>Extend chat</Text>
                    <Text style={styles.extendSubtitle}>
                      Choose how long you want to keep this chat alive.
                    </Text>

                    {/* Scrollable picker: ~3 visible at once, all options scrollable */}
                    <View style={styles.extendWheel}>
                      <ScrollView
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                      >
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

              {/* End-chat confirmation modal (TEMPORARY) */}
              {confirmEndVisible && !isPermanent && (
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

              {/* Incoming Permanent Chat Request modal */}
              {incomingPermanentPrompt && !isPermanent && (
                <View style={styles.modalOverlay}>
                  <View style={styles.confirmCard}>
                    <Text style={styles.confirmTitle}>
                      Permanent Chat Request
                    </Text>
                    <Text style={styles.confirmText}>
                      The other person wants to switch this to a permanent
                      chat. Do you accept?
                    </Text>
                    <View style={styles.confirmButtonsRow}>
                      <TouchableOpacity
                        style={styles.modalSecondary}
                        onPress={declinePermanent}
                      >
                        <Text style={styles.modalSecondaryText}>
                          Not now
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.modalPrimary}
                        onPress={acceptPermanent}
                      >
                        <Text style={styles.modalPrimaryText}>Accept</Text>
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
  const now = Date.now();
  const visibleTemp = activeTemporary.filter(
    (s) => !s.expiresAtMs || s.expiresAtMs > now
  );
  const hasActiveTemp = visibleTemp.length > 0;

  const totalUnreadTemp = visibleTemp.reduce(
    (sum, s) => sum + (s.unreadCount || 0),
    0
  );

  const totalUnreadPerm = permanentChats.reduce(
    (sum, s) => sum + (s.unreadCount || 0),
    0
  );

  let tempSubtitle = "";
  if (!hasActiveTemp) {
    tempSubtitle = "You have 0 temporary chats.";
  } else if (visibleTemp.length === 1) {
    tempSubtitle =
      totalUnreadTemp > 0
        ? `You have 1 temporary chat, ${totalUnreadTemp} new message${
            totalUnreadTemp === 1 ? "" : "s"
          }.`
        : "You have 1 temporary chat. No new messages.";
  } else {
    tempSubtitle =
      totalUnreadTemp > 0
        ? `You have ${visibleTemp.length} temporary chats, ${totalUnreadTemp} new messages.`
        : `You have ${visibleTemp.length} temporary chats. No new messages.`;
  }

  const hasPermanent = permanentChats && permanentChats.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ImageBackground
        source={homeBgImage}
        style={styles.homeBg}
        imageStyle={styles.homeBgImage}
      >
        <Image
          source={require("./assets/logo/blink-logo.png")}
          style={styles.logoImage}
        />

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

        {/* Permanent Chats card */}
        {hasPermanent && (
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.bigCard}
            onPress={() => setMode("permanentList")}
          >
            <View style={styles.cardRow}>
              <Image source={permanentChatImage} style={styles.cardIcon} />
              <View style={styles.cardTextBlock}>
                <Text style={styles.cardTitle}>Permanent Chats</Text>
                <Text style={styles.cardSubtitle}>
                  {permanentChats.length === 0
                    ? "No permanent chats yet."
                    : totalUnreadPerm > 0
                    ? `${permanentChats.length} permanent chat${
                        permanentChats.length === 1 ? "" : "s"
                      }, ${totalUnreadPerm} new message${
                        totalUnreadPerm === 1 ? "" : "s"
                      }.`
                    : `${permanentChats.length} permanent chat${
                        permanentChats.length === 1 ? "" : "s"
                      }.`}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Temporary Chats card */}
        {hasActiveTemp && (
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
                <Text style={styles.cardTitle}>Temporary Chats</Text>
                <Text style={styles.cardSubtitle}>{tempSubtitle}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      </ImageBackground>
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

  homeBg: {
    flex: 1,
    width: "100%",
    alignItems: "center",
  },
  homeBgImage: {
    resizeMode: "cover",
    opacity: 0.1, // no gray tint
  },

  listBg: {
    flex: 1,
    width: "100%",
  },

  logoImage: {
    width: 240,
    height: 240,
    resizeMode: "contain",
    marginTop: 1,
    marginBottom: 1,
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
  cameraTapArea: {
    width: "80%",
  },
  cameraFrame: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#182640",
    overflow: "hidden",
    backgroundColor: COLORS.navySoft,
  },
  cameraHintWrap: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cameraHintText: {
    color: COLORS.textSoft,
    fontFamily: "Poppins-Regular",
    fontSize: 11,
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
    textAlign: "center",
  },
  qrCard: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
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
    paddingBottom: 10,
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
    marginHorizontal: 8,
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
    paddingHorizontal: 14,
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
    marginVertical: 4,
    borderRadius: 12,
    maxWidth: "80%",
  },
  chatRight: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.gold,
    padding: 10,
    marginVertical: 4,
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
    paddingTop: 4,
    paddingBottom: 2,
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 999,
    minHeight: 40,
    maxHeight: 40,
    color: COLORS.offWhite,
    backgroundColor: "#0D1727",
    textAlignVertical: "center",
    includeFontPadding: false,
    fontFamily: "Poppins-Regular",
    fontSize: 14,
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.gold,
    marginRight: 6,
  },
  sendButtonText: {
    color: COLORS.navy,
    fontFamily: "Montserrat-Bold",
  },
  keyboardButton: {
    padding: 6,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#22324C",
    backgroundColor: "transparent",
  },
  keyboardIcon: {
    width: 28,
    height: 28,
    resizeMode: "contain",
  },

  countdownPill: {
    alignSelf: "center",
    marginTop: 2,
    marginBottom: 2,
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

  permanentRequestButton: {
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.gold,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  permanentRequestText: {
    color: COLORS.gold,
    fontFamily: "Montserrat-Bold",
    fontSize: 13,
  },

  footerButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 6,
    gap: 12,
  },
  endChatButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22324C",
    alignItems: "center",
    backgroundColor: COLORS.navySoft,
  },
  extendChatButton: {
    flex: 1,
    paddingVertical: 10,
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
    textAlign: "center",
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
    height: 80, // ~3 rows visible
    marginBottom: 14,
    overflow: "hidden",
    backgroundColor: "#111D33",
    borderRadius: 8,
  },

  extendOptionRow: {
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  extendOptionRowSelected: {
    backgroundColor: "transparent",
  },
  extendOptionText: {
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
    fontSize: 16,
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

  // Active / Permanent list screen
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

  permanentListItem: {
    backgroundColor: COLORS.navySoft,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#182640",
    flexDirection: "row",
    alignItems: "center",
  },
  permanentListPress: {
    flex: 1,
    marginRight: 8,
  },
  permanentDeleteButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4A4A6A",
  },
  permanentDeleteText: {
    fontSize: 11,
    color: COLORS.textSoft,
    fontFamily: "Poppins-Regular",
  },
  permanentPadlockIcon: {
    width: 18,
    height: 18,
    marginLeft: 6,
    resizeMode: "contain",
  },

  readOnlyBanner: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  readOnlyBannerText: {
    fontSize: 12,
    fontFamily: "Poppins-Regular",
    color: COLORS.textSoft,
    textAlign: "center",
  },
});
