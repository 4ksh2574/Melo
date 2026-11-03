import { useEffect, useMemo, useState, type FormEvent, type TouchEvent } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type Member = {
  uid: string;
  displayName?: string;
  username?: string;
  active?: boolean;
  photoURL?: string;
};
type Stamp = { toMillis?: () => number; toDate?: () => Date } | number | null;
type Message = {
  id: string;
  source: string;
  uid: string;
  text: string;
  createdAt?: Stamp;
  expiresAt?: Stamp;
};
type Conversation = {
  id: string;
  type: "direct" | "group";
  memberIds: string[];
  title?: string;
  createdAt?: Stamp;
  updatedAt?: Stamp;
  isPermanent?: boolean;
  disappearingAfterSeconds?: number;
  legacy?: boolean;
  demo?: boolean;
};
type DemoStore = {
  version: 1;
  expiresAt: number;
  conversations: Conversation[];
  messages: Record<string, Message[]>;
};
type Gate = "checking" | "signed-out" | "approved" | "pending" | "error";
type ThemePreference = "light" | "dark" | "system";
type ChatPanel = "chat" | "details" | "media" | "disappearing" | "screenshots" | "safety" | "nickname";
type MediaTab = "media" | "docs" | "links";
type Tab = "home" | "chats" | "profile";
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "chats", label: "Chats", icon: "◌" },
  { id: "profile", label: "Profile", icon: "◎" },
];
const chatId = (a: string, b: string) => [a, b].sort().join("__");
const nameOf = (m?: Member) => m?.displayName || m?.username || "Melo member";
const initials = (s: string) => (s.trim()[0] || "M").toUpperCase();
const stampValue = (stamp?: Stamp) => {
  if (typeof stamp === "number") return stamp;
  return stamp?.toMillis?.() ?? 0;
};
const DEMO_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const demoMembers: Member[] = [
  { uid: "demo-ava", displayName: "Ava Morgan" },
  { uid: "demo-noah", displayName: "Noah Park" },
  { uid: "demo-mira", displayName: "Mira Shah" },
];
function buildDemoStore(uid: string, now = Date.now()): DemoStore {
  const memberIds = (ids: string[]) => [uid, ...ids].sort();
  const message = (id: string, sender: string, text: string, minutesAgo: number): Message => ({
    id, source: "demo", uid: sender, text, createdAt: now - minutesAgo * 60_000,
  });
  const conversations: Conversation[] = [
    { id: "demo-direct-ava", type: "direct", title: "Ava Morgan", memberIds: memberIds(["demo-ava"]), demo: true, createdAt: now - 60 * 60_000, updatedAt: now - 2 * 60_000 },
    { id: "demo-direct-noah", type: "direct", title: "Noah Park", memberIds: memberIds(["demo-noah"]), demo: true, createdAt: now - 2 * 60 * 60_000, updatedAt: now - 18 * 60_000 },
    { id: "demo-group-weekend", type: "group", title: "Weekend plans", memberIds: memberIds(["demo-ava", "demo-noah", "demo-mira"]), demo: true, createdAt: now - 3 * 60 * 60_000, updatedAt: now - 7 * 60_000 },
    { id: "demo-group-study", type: "group", title: "Study circle", memberIds: memberIds(["demo-noah", "demo-mira"]), demo: true, createdAt: now - 4 * 60 * 60_000, updatedAt: now - 28 * 60_000 },
  ];
  return {
    version: 1,
    expiresAt: now + DEMO_TTL_MS,
    conversations,
    messages: {
      "demo-direct-ava": [
        message("ava-1", "demo-ava", "Hey! This is a sample direct conversation.", 16),
        message("ava-2", uid, "Nice — I’m testing how Melo feels on my phone.", 13),
        message("ava-3", "demo-ava", "The sample messages stay on this device, by the way ✨", 2),
      ],
      "demo-direct-noah": [
        message("noah-1", "demo-noah", "Have you tried the new chat layout?", 42),
        message("noah-2", uid, "Yes. The inbox is looking much cleaner now.", 35),
        message("noah-3", "demo-noah", "Great! This is just placeholder test data.", 18),
      ],
      "demo-group-weekend": [
        message("weekend-1", "demo-ava", "Should we make a plan for the weekend?", 31),
        message("weekend-2", "demo-noah", "I’m in. A relaxed catch-up sounds good.", 24),
        message("weekend-3", "demo-mira", "Same here — let’s decide in this group.", 12),
        message("weekend-4", uid, "Group chat testing looks good so far 👍", 7),
      ],
      "demo-group-study": [
        message("study-1", "demo-mira", "I’ve added a few sample messages here.", 65),
        message("study-2", "demo-noah", "The sender labels should show for everyone.", 48),
        message("study-3", uid, "Perfect. Checking the group layout too.", 28),
      ],
    },
  };
}
const expiryChoices = [
  { seconds: 0, label: "Off" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 28800, label: "8 hours" },
  { seconds: 86400, label: "1 day" },
  { seconds: 604800, label: "1 week" },
  { seconds: 2419200, label: "4 weeks" },
];
const expiryLabel = (seconds: number) =>
  expiryChoices.find((choice) => choice.seconds === seconds)?.label || "Off";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [gate, setGate] = useState<Gate>("checking");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = window.localStorage.getItem("melo-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [legacyChats, setLegacyChats] = useState<Conversation[]>([]);
  const [demoConversations, setDemoConversations] = useState<Conversation[]>([]);
  const [demoMessages, setDemoMessages] = useState<Record<string, Message[]>>({});
  const [demoExpiresAt, setDemoExpiresAt] = useState(0);
  const [demoReady, setDemoReady] = useState(false);
  const [active, setActive] = useState<Conversation | null>(null);
  const [chatPanel, setChatPanel] = useState<ChatPanel>("chat");
  const [mediaTab, setMediaTab] = useState<MediaTab>("media");
  const [nickname, setNickname] = useState("");
  const [disappearingAfterSeconds, setDisappearingAfterSeconds] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<Message[]>([]);
  const [fourMessages, setFourMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [swipeX, setSwipeX] = useState<number | null>(null);
  const [swipeY, setSwipeY] = useState<number | null>(null);
  const [groupPanel, setGroupPanel] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = themePreference === "system"
        ? (media.matches ? "dark" : "light")
        : themePreference;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };
    window.localStorage.setItem("melo-theme", themePreference);
    apply();
    if (themePreference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themePreference]);

  useEffect(() => onAuthStateChanged(auth, async (nextUser) => {
    setUser(nextUser);
    if (!nextUser) {
      setGate("signed-out");
      setMembers([]);
      setMembersLoaded(false);
      return;
    }
    setGate("checking");
    try {
      const membership = await getDoc(doc(db, "members", nextUser.uid));
      setGate(membership.exists() && membership.data().active === true ? "approved" : "pending");
    } catch (error) {
      console.error(error);
      setNotice("We couldn't verify your membership. Check your connection.");
      setGate("error");
    }
  }), []);

  useEffect(() => {
    if (gate !== "approved" || !user) return;
    setMembersLoaded(false);
    const membersQuery = query(collection(db, "members"), where("active", "==", true));
    const unsubscribe = onSnapshot(
      membersQuery,
      (snapshot) => {
        setMembers(snapshot.docs
          .map((item) => ({ uid: item.id, ...item.data() } as Member))
          .filter((member) => member.uid !== user.uid));
        setMembersLoaded(true);
      },
      (error) => {
        console.error(error);
        setNotice("Couldn't load your circle.");
        setMembersLoaded(true);
      },
    );
    return unsubscribe;
  }, [gate, user]);

  useEffect(() => {
    if (gate !== "approved" || !user) return;
    const conversationsQuery = query(
      collection(db, "conversations"),
      where("memberIds", "array-contains", user.uid),
    );
    const unsubscribeConversations = onSnapshot(conversationsQuery, (snapshot) => {
      const refreshed = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      } as Conversation));
      setConversations(refreshed);
      setActive((current) => {
        const latest = current && refreshed.find((item) => item.id === current.id);
        return current && latest ? { ...current, ...latest } : current;
      });
    }, (error) => {
      console.error(error);
      setNotice("Couldn't load your conversations.");
    });
    const legacyQuery = query(
      collection(db, "chats"),
      where("memberIds", "array-contains", user.uid),
    );
    const unsubscribeLegacy = onSnapshot(legacyQuery, (snapshot) => {
      setLegacyChats(snapshot.docs.map((item) => ({
        id: item.id,
        type: "direct",
        legacy: true,
        ...item.data(),
      } as Conversation)));
    }, (error) => {
      console.error("Legacy inbox read:", error);
    });
    return () => {
      unsubscribeConversations();
      unsubscribeLegacy();
    };
  }, [gate, user]);

  // Create The Four once all four approved accounts are present. Existing room
  // messages remain in their original collection and are displayed alongside new messages.
  useEffect(() => {
    if (gate !== "approved" || !user || !membersLoaded || members.length !== 3) return;
    const ref = doc(db, "conversations", "the-four");
    let cancelled = false;
    getDoc(ref).then((snapshot) => {
      if (cancelled || snapshot.exists()) return;
      const memberIds = [user.uid, ...members.map((member) => member.uid)].sort();
      return setDoc(ref, {
        type: "group",
        title: "The Four",
        memberIds,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        isPermanent: true,
      });
    }).catch((error) => {
      console.error("The Four setup:", error);
      setNotice("The Four couldn't be initialized. Check the new conversation Firestore rules.");
    });
    return () => { cancelled = true; };
  }, [gate, user, members, membersLoaded]);

  useEffect(() => {
    if (gate !== "approved" || !user) {
      setDemoConversations([]);
      setDemoMessages({});
      setDemoExpiresAt(0);
      setDemoReady(false);
      return;
    }
    setDemoReady(false);
    const storageKey = "melo-demo-data:" + user.uid;
    let store: DemoStore | null = null;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as DemoStore;
        if (parsed.version === 1 && parsed.expiresAt > Date.now()
          && Array.isArray(parsed.conversations) && parsed.messages
          && typeof parsed.messages === "object") store = parsed;
      }
    } catch (error) {
      console.warn("Saved sample data could not be read; rebuilding it.", error);
    }
    if (!store) store = buildDemoStore(user.uid);
    setDemoConversations(store.conversations);
    setDemoMessages(store.messages);
    setDemoExpiresAt(store.expiresAt);
    setDemoReady(true);
    try { window.localStorage.setItem(storageKey, JSON.stringify(store)); }
    catch (error) { console.warn("Sample data could not be saved on this device.", error); }
  }, [gate, user?.uid]);

  useEffect(() => {
    if (!demoReady || !user || !demoExpiresAt) return;
    try {
      window.localStorage.setItem("melo-demo-data:" + user.uid, JSON.stringify({
        version: 1, expiresAt: demoExpiresAt, conversations: demoConversations, messages: demoMessages,
      } satisfies DemoStore));
    } catch (error) {
      console.warn("Sample messages could not be saved on this device.", error);
    }
  }, [demoReady, demoExpiresAt, demoConversations, demoMessages, user?.uid]);

  useEffect(() => {
    setChatPanel("chat");
    setMediaTab("media");
    if (!active || !user) {
      setNickname("");
      return;
    }
    setNickname(window.localStorage.getItem("melo-nickname:" + user.uid + ":" + active.id) || "");
  }, [active?.id, user?.uid]);

  useEffect(() => {
    setDisappearingAfterSeconds(active?.disappearingAfterSeconds || 0);
  }, [active?.id, active?.disappearingAfterSeconds]);

  useEffect(() => {
    if (!active || !messages.length) return;
    const expiring = messages.filter((message) => message.expiresAt && stampValue(message.expiresAt) > Date.now());
    if (!expiring.length) return;
    const nextExpiry = Math.min(...expiring.map((message) => stampValue(message.expiresAt)));
    const timeout = window.setTimeout(() => {
      const now = Date.now();
      const due = messages.filter((message) => message.expiresAt && stampValue(message.expiresAt) <= now);
      setMessages((current) => current.filter((message) => !message.expiresAt || stampValue(message.expiresAt) > now));
      due.forEach((message) => {
        deleteDoc(doc(db, "conversations", active.id, "messages", message.id)).catch((error) => {
          console.warn("Expired message cleanup will retry when the chat is opened:", error);
        });
      });
    }, Math.max(100, nextExpiry - Date.now() + 500));
    return () => window.clearTimeout(timeout);
  }, [messages, active?.id]);

  useEffect(() => {
    if (!user || !active) {
      setMessages([]);
      setLegacyMessages([]);
      setFourMessages([]);
      return;
    }
    setMessages([]);
    setLegacyMessages([]);
    setFourMessages([]);
    if (active.demo) {
      return;
    }
    const base = collection(db, "conversations", active.id, "messages");
    const unsubscribeNew = onSnapshot(query(base, orderBy("createdAt", "asc")), (snapshot) => {
      const loaded = snapshot.docs.map((item) => ({
        id: item.id,
        source: "conversation",
        ...item.data(),
      } as Message));
      const now = Date.now();
      const live = loaded.filter((message) => !message.expiresAt || stampValue(message.expiresAt) > now);
      loaded.filter((message) => message.expiresAt && stampValue(message.expiresAt) <= now)
        .forEach((message) => {
          deleteDoc(doc(base, message.id)).catch((error) => {
            console.warn("Expired message cleanup will retry later:", error);
          });
        });
      setMessages(live);
    }, (error) => {
      console.error("Conversation messages:", error);
      setNotice("New messages couldn't be loaded. Check Firestore rules.");
    });

    let unsubscribeLegacy: (() => void) | undefined;
    let unsubscribeFour: (() => void) | undefined;
    if (active.type === "direct") {
      unsubscribeLegacy = onSnapshot(
        query(collection(db, "chats", active.id, "messages"), orderBy("createdAt", "asc")),
        (snapshot) => setLegacyMessages(snapshot.docs.map((item) => ({
          id: item.id,
          source: "legacy-direct",
          ...item.data(),
        } as Message))),
        (error) => console.error("Legacy direct history:", error),
      );
    }
    if (active.id === "the-four") {
      unsubscribeFour = onSnapshot(
        query(collection(db, "rooms", "the-four", "messages"), orderBy("createdAt", "asc")),
        (snapshot) => setFourMessages(snapshot.docs.map((item) => ({
          id: item.id,
          source: "legacy-four",
          ...item.data(),
        } as Message))),
        (error) => console.error("Legacy The Four history:", error),
      );
    }
    return () => {
      unsubscribeNew();
      unsubscribeLegacy?.();
      unsubscribeFour?.();
    };
  }, [user?.uid, active?.id]);

  const allMembers = useMemo(() => user
    ? [{ uid: user.uid, displayName: user.displayName || user.email || "You" }, ...members, ...(demoReady ? demoMembers : [])]
    : members, [user, members, demoReady]);

  const inbox = useMemo(() => {
    const merged = new Map<string, Conversation>();
    legacyChats.forEach((item) => merged.set(item.id, item));
    conversations.forEach((item) => merged.set(item.id, item));
    return [...merged.values()].sort((a, b) =>
      stampValue(b.updatedAt || b.createdAt) - stampValue(a.updatedAt || a.createdAt));
  }, [conversations, legacyChats]);

  const allMessages = useMemo(() => [
    ...messages,
    ...legacyMessages,
    ...fourMessages,
    ...(active?.demo ? demoMessages[active.id] || [] : []),
  ].sort((a, b) => stampValue(a.createdAt) - stampValue(b.createdAt)), [messages, legacyMessages, fourMessages, active?.id, active?.demo, demoMessages]);

  const titleOf = (conversation: Conversation) => {
    if (conversation.id === "the-four") return "The Four";
    if (conversation.demo && conversation.title) return conversation.title;
    if (conversation.type === "group") return conversation.title || "Private group";
    if (active?.id === conversation.id && nickname.trim()) return nickname.trim();
    const otherId = conversation.memberIds.find((id) => id !== user?.uid);
    return nameOf(allMembers.find((member) => member.uid === otherId));
  };

  const saveNickname = (value: string) => {
    setNickname(value);
    if (user && active) {
      const key = "melo-nickname:" + user.uid + ":" + active.id;
      if (value.trim()) window.localStorage.setItem(key, value.trim());
      else window.localStorage.removeItem(key);
    }
  };

  async function setExpiry(seconds: number) {
    if (!active) return;
    if (active.demo) {
      setNotice("Conversation settings are preview-only in sample chats.");
      return;
    }
    try {
      await updateDoc(doc(db, "conversations", active.id), { disappearingAfterSeconds: seconds });
      setDisappearingAfterSeconds(seconds);
      setActive({ ...active, disappearingAfterSeconds: seconds });
      setNotice(seconds === 0
        ? "Disappearing messages turned off for new messages."
        : "New messages will expire after " + expiryLabel(seconds) + ".");
      setChatPanel("details");
    } catch (error) {
      console.error("Disappearing message setting:", error);
      setNotice("Couldn't save this setting. Check the updated Firestore rules.");
    }
  }

  const extractedLinks = allMessages.flatMap((message) => message.text.split(/\s+/)
    .filter((word) => word.startsWith("https://") || word.startsWith("http://"))
    .map((url) => ({ url: url.replace(/[.,!?]+$/, ""), id: message.source + ":" + message.id, text: message.text })));

  async function openDirect(member: Member) {
    if (!user) return;
    const id = chatId(user.uid, member.uid);
    const ref = doc(db, "conversations", id);
    try {
      const existing = await getDoc(ref);
      if (!existing.exists()) {
        await setDoc(ref, {
          type: "direct",
          memberIds: [user.uid, member.uid].sort(),
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      setActive({
        id,
        type: "direct",
        memberIds: [user.uid, member.uid].sort(),
      });
      setTab("chats");
    } catch (error) {
      console.error(error);
      setNotice("Couldn't open this private conversation. Check membership and Firestore rules.");
    }
  }

  async function openConversation(conversation: Conversation) {
    if (!user) return;
    try {
      if (!conversation.demo && (conversation.type === "direct" || conversation.id === "the-four")) {
        const ref = doc(db, "conversations", conversation.id);
        const snapshot = await getDoc(ref);
        if (!snapshot.exists()) {
          await setDoc(ref, conversation.id === "the-four" ? {
            type: "group",
            title: "The Four",
            memberIds: conversation.memberIds.slice().sort(),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            isPermanent: true,
          } : {
            type: "direct",
            memberIds: conversation.memberIds.slice().sort(),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
        }
      }
      setActive(conversation);
      setTab("chats");
    } catch (error) {
      console.error(error);
      setNotice("Couldn't open this conversation.");
    }
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    const memberIds = [user.uid, ...selectedMembers].sort();
    const title = groupTitle.trim();
    if (memberIds.length < 2 || memberIds.length > 4 || !title || title.length > 40) {
      setNotice("Choose 1–3 friends and give the group a name (up to 40 characters).");
      return;
    }
    setBusy(true);
    try {
      const created = await addDoc(collection(db, "conversations"), {
        type: "group",
        title,
        memberIds,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      setGroupPanel(false);
      setGroupTitle("");
      setSelectedMembers([]);
      setActive({ id: created.id, type: "group", title, memberIds });
      setTab("chats");
    } catch (error) {
      console.error(error);
      setNotice("Group creation failed. Check that all selected accounts are approved.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !user || !active) return;
    if (active.demo) {
      const sampleReply: Message = {
        id: "demo-user-" + Date.now(), source: "demo", uid: user.uid, text, createdAt: Date.now(),
      };
      setDemoMessages((current) => ({ ...current, [active.id]: [...(current[active.id] || []), sampleReply] }));
      setDraft("");
      return;
    }
    setBusy(true);
    try {
      await addDoc(collection(db, "conversations", active.id, "messages"), {
        uid: user.uid,
        text,
        createdAt: serverTimestamp(),
        ...(disappearingAfterSeconds > 0
          ? { expiresAt: Timestamp.fromMillis(Date.now() + disappearingAfterSeconds * 1000) }
          : {}),
      });
      setDraft("");
    } catch (error) {
      console.error(error);
      setNotice("Message not sent. Check your connection and Firestore conversation rules.");
    } finally {
      setBusy(false);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      console.error(error);
      setNotice("Sign-in failed. Check your details.");
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin() {
    setBusy(true);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (error) {
      console.error(error);
      setNotice("Google sign-in couldn't start.");
      setBusy(false);
    }
  }

  if (gate === "checking") {
    return <main className="center"><div className="brand">melo<span>.</span></div><div className="loader" /><p>Opening your circle…</p></main>;
  }
  if (gate === "signed-out") {
    return <main className="center"><section className="auth">
      <div className="brand">melo<span>.</span></div>
      <small>YOUR PRIVATE CIRCLE</small>
      <h1>Closer, even from afar.</h1>
      <p>A quiet little space for the four of you.</p>
      <form onSubmit={login}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button className="primary" disabled={busy}>Sign in</button>
      </form>
      <button className="secondary" onClick={googleLogin} disabled={busy}>Continue with Google</button>
      {notice && <p className="notice">{notice}</p>}
    </section></main>;
  }
  if (gate === "pending" || gate === "error") {
    return <main className="center"><section className="auth">
      <div className="brand">melo<span>.</span></div>
      <h1>{gate === "pending" ? "You're not in the circle yet." : "Connection issue"}</h1>
      <p>{gate === "pending" ? "This account hasn't been approved for Melo." : notice}</p>
      <button className="secondary" onClick={() => signOut(auth)}>Sign out</button>
    </section></main>;
  }

  const ordered = members.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const fourReady = members.length === 3;
  const touchStart = (event: TouchEvent) => {
    if (active) return;
    setSwipeX(event.touches[0].clientX);
    setSwipeY(event.touches[0].clientY);
  };
  const touchEnd = (event: TouchEvent) => {
    if (swipeX === null || swipeY === null || active) return;
    const dx = event.changedTouches[0].clientX - swipeX;
    const dy = event.changedTouches[0].clientY - swipeY;
    setSwipeX(null);
    setSwipeY(null);
    if (Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const index = tabs.findIndex((item) => item.id === tab);
      const next = Math.max(0, Math.min(tabs.length - 1, index + (dx < 0 ? 1 : -1)));
      setTab(tabs[next].id);
    }
  };
  const label = tab === "home" ? "Home" : tab === "chats" ? "Chats" : "Profile";

  return <main className="app" onTouchStart={touchStart} onTouchEnd={touchEnd}>
    {!active && (tab === "home" || tab === "profile") && <header className="top top-logo-only">
      <div className="brand">melo<span>.</span></div>
    </header>
    {notice && <button className="noticebar" onClick={() => setNotice("")}>{notice}<b>×</b></button>}

    {active ? <section className="conversation">
      {chatPanel === "chat" ? <>
        <header className="conversation-head">
          <button className="back" onClick={() => setActive(null)} aria-label="Back to chats">‹</button>
          <button className="chat-person-trigger" onClick={() => setChatPanel("details")} aria-label="Conversation details">
            <span className="avatar">{active.type === "group" ? "✳" : initials(titleOf(active))}</span>
            <span className="conversation-title"><strong>{titleOf(active)}</strong><small>{active.demo ? "Sample · This device only" : active.type === "group" ? active.memberIds.length + " members · Private group" : "Private conversation"}</small></span>
          </button>
          <button className="chat-more" onClick={() => setChatPanel("details")} aria-label="More conversation options">···</button>
        </header>
        <div className="messages">
          {allMessages.length ? allMessages.map((message, index) => {
            const mine = message.uid === user?.uid;
            const sender = allMembers.find((member) => member.uid === message.uid);
            return <div key={message.source + ":" + message.id}
              className={"message-wrap message-enter " + (mine ? "mine-wrap" : "")}
              style={{ animationDelay: Math.min(index, 10) * 24 + "ms" }}>
              {active.type === "group" && !mine && <small className="message-sender">{nameOf(sender)}</small>}
              <div className={"bubble " + (mine ? "mine" : "")}>{message.text}</div>
            </div>;
          }) : <p className="empty">A little hello goes a long way ✨</p>}
        </div>
        {disappearingAfterSeconds > 0 && <div className="expiry-banner">◷ New messages disappear after {expiryLabel(disappearingAfterSeconds).toLowerCase()}</div>}
        <form className="composer" onSubmit={sendMessage}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" maxLength={4000} />
          <button className="send" disabled={busy || !draft.trim()}>↑</button>
        </form>
      </> : <div className="chat-subview">
        <header className="subview-head">
          <button className="back" onClick={() => setChatPanel(chatPanel === "details" ? "chat" : "details")} aria-label="Back">‹</button>
          <h2>{chatPanel === "details" ? "Conversation info" : chatPanel === "media" ? "Media, Links, Docs" : chatPanel === "disappearing" ? "Disappearing messages" : chatPanel === "screenshots" ? "Screenshot protection" : chatPanel === "safety" ? "Safety number" : "Add nickname"}</h2>
          {chatPanel === "nickname" && <button className="text-action" onClick={() => setChatPanel("details")}>Done</button>}
          {chatPanel !== "nickname" && <span className="subview-spacer" />}
        </header>
        {chatPanel === "details" && <>
          <div className="chat-profile-hero">
            <div className="avatar detail-avatar">{active.type === "group" ? "✳" : initials(titleOf(active))}</div>
            <h1>{titleOf(active)}</h1>
            <p>{active.type === "group" ? active.memberIds.length + " members · Private group" : "Private conversation"}</p>
            <button className="nickname-shortcut" onClick={() => setChatPanel("nickname")}>✎ {nickname ? "Edit nickname" : "Add nickname"}</button>
          </div>
          <div className="details-actions">
            <button onClick={() => setChatPanel("media")}><span>▧</span><small>Media</small></button>
            <button onClick={() => setChatPanel("disappearing")}><span>◷</span><small>Timer</small></button>
            <button onClick={() => setChatPanel("nickname")}><span>✎</span><small>Nickname</small></button>
          </div>
          {active.type === "group" && <div className="detail-card">
            <div className="detail-card-heading">Members <span>{active.memberIds.length}</span></div>
            {allMembers.filter((member) => active.memberIds.includes(member.uid)).map((member) =>
              <div className="detail-member" key={member.uid}><span className="avatar">{initials(nameOf(member))}</span><span>{nameOf(member)}</span>{member.uid === user?.uid && <small>You</small>}</div>
            )}
          </div>}
          <div className="detail-card settings-list">
            <button className="detail-row" onClick={() => setChatPanel("media")}><span className="detail-icon">▧</span><span><strong>Media, Links, Docs</strong><small>Shared items in this conversation</small></span><b>›</b></button>
            <button className="detail-row" onClick={() => setChatPanel("disappearing")}><span className="detail-icon">◷</span><span><strong>Disappearing messages</strong><small>{expiryLabel(disappearingAfterSeconds)}</small></span><b>›</b></button>
            <button className="detail-row" onClick={() => setChatPanel("screenshots")}><span className="detail-icon">▣</span><span><strong>Block screenshots</strong><small>Not supported in a web browser</small></span><b>›</b></button>
            <button className="detail-row" onClick={() => setChatPanel("safety")}><span className="detail-icon">◇</span><span><strong>Safety number</strong><small>End-to-end verification unavailable</small></span><b>›</b></button>
          </div>
        </>}
        {chatPanel === "media" && <>
          <div className="media-tabs">
            {(["media", "docs", "links"] as MediaTab[]).map((value) =>
              <button key={value} className={mediaTab === value ? "selected" : ""} onClick={() => setMediaTab(value)}>
                {value === "media" ? "Media" : value === "docs" ? "Docs" : "Links"}
              </button>
            )}
          </div>
          {mediaTab === "links" && extractedLinks.length ? <div className="shared-links">
            {extractedLinks.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>↗</span><div><strong>{item.url}</strong><small>{item.text}</small></div></a>)}
          </div> : <div className="media-empty"><span>{mediaTab === "media" ? "▧" : mediaTab === "docs" ? "▤" : "↗"}</span><strong>No {mediaTab === "media" ? "media" : mediaTab === "docs" ? "documents" : "links"} yet</strong><p>{mediaTab === "media" ? "Photos and videos can be added when Melo's secure file sharing is introduced." : mediaTab === "docs" ? "Shared documents will appear here." : "Links shared in messages will appear here."}</p></div>}
        </>}
        {chatPanel === "disappearing" && <>
          <div className="settings-intro"><span>◷</span><p>Choose how long <strong>new messages</strong> stay in this conversation. The timer starts when a message is sent. Existing messages are not changed.</p></div>
          <div className="duration-list">
            {expiryChoices.map((choice) => <button key={choice.seconds} className={disappearingAfterSeconds === choice.seconds ? "chosen" : ""} onClick={() => setExpiry(choice.seconds)}>
              <span>{choice.label}</span>{disappearingAfterSeconds === choice.seconds && <b>✓</b>}
            </button>)}
          </div>
          <p className="settings-footnote">Expired messages are hidden and cleaned up when a member opens this conversation again. This is not a guaranteed deletion timer while everyone is offline.</p>
        </>}
        {chatPanel === "screenshots" && <div className="capability-notice">
          <span>▣</span><h3>Screenshot blocking isn't available on the web.</h3>
          <p>A browser-based app cannot reliably stop the operating system or another device from capturing the screen. Melo won't show a switch that suggests otherwise.</p>
          <div className="capability-status">Unavailable on this platform</div>
        </div>}
        {chatPanel === "safety" && <div className="capability-notice">
          <span>◇</span><h3>Safety-number verification isn't available yet.</h3>
          <p>Melo doesn't currently implement end-to-end encryption. Firebase protects data in transit and at rest, but that is not the same as end-to-end encryption. A verification code or QR here would be misleading.</p>
          <div className="capability-status">End-to-end encryption not enabled</div>
        </div>}
        {chatPanel === "nickname" && <div className="nickname-page">
          <div className="nickname-info">ⓘ This nickname is private to you and is saved only on this device.</div>
          <label htmlFor="chat-nickname">Nickname</label>
          <input id="chat-nickname" value={nickname} onChange={(event) => saveNickname(event.target.value)} placeholder="Add nickname" maxLength={40} autoFocus />
          <button className="clear-nickname" onClick={() => saveNickname("")} disabled={!nickname}>Remove nickname</button>
        </div>}
      </div>}
    </section> : <>
      <section className="content" key={tab}>
        <div className="heading">
          <div><small>MELO · {label.toUpperCase()}</small><h1>{tab === "home" ? "Your circle" : label}</h1></div>
          {tab === "home" && <div className="avatar">{initials(user?.displayName || "M")}</div>}
        </div>

        {tab === "home" && <>
          <div className="people-strip">
            <div className="person"><div className="avatar own">{initials(user?.displayName || "M")}</div><small>You</small></div>
            {ordered.map((member) => <button className="person" key={member.uid} onClick={() => openDirect(member)}>
              <div className="avatar">{initials(nameOf(member))}</div><small>{nameOf(member).split(" ")[0]}</small>
            </button>)}
          </div>
        </>}

        {tab === "chats" && <>
          <div className="chat-toolbar">
            <div className="chat-toolbar-copy"><small>PRIVATE INBOX</small><span>{inbox.filter((item) => item.id !== "the-four").length + (fourReady ? 1 : 0)} conversations</span></div>
            <button className="primary compact" onClick={() => setGroupPanel((open) => !open)}>＋ New group</button>
          </div>
          {groupPanel && <form className="group-panel" onSubmit={createGroup}>
            <label>Group name<input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="e.g. Weekend plans" maxLength={40} required /></label>
            <div className="group-panel-label">Choose 1–3 friends <span>{selectedMembers.length}/3</span></div>
            <div className="group-picks">{ordered.map((member) => <label className="group-pick" key={member.uid}>
              <input type="checkbox" checked={selectedMembers.includes(member.uid)}
                disabled={!selectedMembers.includes(member.uid) && selectedMembers.length >= 3}
                onChange={(event) => setSelectedMembers((current) => event.target.checked
                  ? [...current, member.uid] : current.filter((id) => id !== member.uid))} />
              <span className="avatar">{initials(nameOf(member))}</span><span>{nameOf(member)}</span>
            </label>)}</div>
            <div className="group-panel-buttons"><button type="button" className="secondary" onClick={() => setGroupPanel(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={busy || selectedMembers.length < 1 || selectedMembers.length > 3}>Create group</button></div>
          </form>}
          {fourReady && <>
            <div className="section-kicker">PINNED</div>
            <button className="chat-row pinned-chat" onClick={() => openConversation({ id: "the-four", type: "group", title: "The Four", memberIds: [user!.uid, ...members.map((member) => member.uid)] })}>
              <div className="avatar group-avatar">✳</div><div className="member-info"><strong>The Four</strong><small>All four of you · Permanent group</small></div><span className="arrow">›</span>
            </button>
          </>}
          {demoReady && demoConversations.length > 0 && <>
            <div className="section-kicker demo-kicker">SAMPLE CHATS <span>LOCAL · 14 DAYS</span></div>
            <div className="member-list demo-list">
              {demoConversations.map((conversation) => {
                const sampleMessages = demoMessages[conversation.id] || [];
                const latest = sampleMessages[sampleMessages.length - 1];
                return <button className="chat-row demo-chat-row" key={conversation.id} onClick={() => openConversation(conversation)}>
                  <div className={"avatar " + (conversation.type === "group" ? "group-avatar" : "")}>{conversation.type === "group" ? "✳" : initials(titleOf(conversation))}</div>
                  <div className="member-info"><strong>{titleOf(conversation)}</strong><small>{latest ? (latest.uid === user?.uid ? "You: " : "") + latest.text : "Sample conversation"}</small></div>
                  <span className="demo-tag">DEMO</span>
                </button>;
              })}
            </div>
            <p className="demo-footnote">Only on this device. Sample chats and your test replies reset after 14 days; nothing is sent to real members.</p>
          </>}
          <div className="section-kicker recent-kicker">RECENT CONVERSATIONS</div>
          <div className="member-list">
            {inbox.filter((item) => item.id !== "the-four").map((conversation) => <button className="chat-row" key={conversation.id} onClick={() => openConversation(conversation)}>
              <div className="avatar">{conversation.type === "group" ? "✳" : initials(titleOf(conversation))}</div>
              <div className="member-info"><strong>{titleOf(conversation)}</strong><small>{conversation.type === "group" ? conversation.memberIds.length + " members · Group" : "Private direct message"}</small></div>
              <span className="arrow">›</span>
            </button>)}
            {!inbox.some((item) => item.id !== "the-four") && <p className="empty">Your private chats and groups will appear here.</p>}
          </div>
        </>}

        {tab === "profile" && <div className="profile-card">
          {!settingsOpen ? <>
            <div className="profile-topline">
              <span className="profile-label">YOUR PROFILE</span>
              <button className="profile-settings-button" type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>⚙</button>
            </div>
            <div className="avatar large">{initials(user?.displayName || "M")}</div>
            <h2>{user?.displayName || "Melo member"}</h2><p>{user?.email}</p>
            <span className="member-badge">✓ Approved member</span>
          </> : <>
            <div className="profile-settings-head">
              <button className="settings-back" type="button" onClick={() => setSettingsOpen(false)} aria-label="Back to profile">‹</button>
              <div><small>PERSONALIZE MELO</small><h2>Settings</h2></div>
            </div>
            <section className="settings-card" aria-labelledby="appearance-title">
              <div className="settings-heading">
                <div><small>DISPLAY</small><h3 id="appearance-title">Appearance</h3></div>
                <span className="settings-symbol" aria-hidden="true">◐</span>
              </div>
              <p>Choose how Melo looks across every screen, including your conversations.</p>
              <div className="theme-options" role="group" aria-label="Theme preference">
                {(["light", "dark", "system"] as ThemePreference[]).map((choice) =>
                  <button key={choice} type="button"
                    className={"theme-option " + (themePreference === choice ? "selected" : "")}
                    aria-pressed={themePreference === choice}
                    onClick={() => setThemePreference(choice)}>
                    <span className={"theme-preview " + choice} aria-hidden="true"><i /><i /><i /></span>
                    <span>{choice[0].toUpperCase() + choice.slice(1)}</span>
                    {themePreference === choice && <b aria-hidden="true">✓</b>}
                  </button>
                )}
              </div>
              <small className="settings-note">{themePreference === "system" ? "Follows your device appearance automatically." : "Your choice is saved on this device."}</small>
            </section>
            <section className="settings-card account-settings" aria-label="Account">
              <div className="settings-heading"><div><small>ACCOUNT</small><h3>Account access</h3></div><span className="settings-symbol" aria-hidden="true">↗</span></div>
              <p>Sign out of this device.</p>
              <button className="signout-button" onClick={() => signOut(auth)}>Sign out</button>
            </section>
          </>}
        </div>}
      </section>
      <nav className="dock"><div className="dock-inner">
        <span className="dock-indicator" style={{ transform: "translateX(" + tabs.findIndex((item) => item.id === tab) * 100 + "%)" }} />
        {tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} aria-label={item.label}>
          <span className="tab-icon">{item.icon}</span><small>{item.label}</small>
        </button>)}
      </div></nav>
    </>}
  </main>;
}
