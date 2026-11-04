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
type PlannerView = "overview" | "tasks" | "calendar" | "routine" | "progress";
type PlannerTask = {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  priority: "low" | "medium" | "high";
  done: boolean;
  createdAt: number;
  googleEventId?: string;
};
type RoutineItem = { id: string; title: string; time: string; days?: number[]; doneDates: string[] };
type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};
type GoogleTokenResponse = { access_token?: string; error?: string; error_description?: string };
type GoogleTokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };
type GoogleOAuthApi = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => GoogleTokenClient;
  revoke?: (token: string, callback: (response: { successful?: boolean }) => void) => void;
};
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuthApi } };
  }
}
const plannerSubjects = ["Physics", "Chemistry", "Mathematics", "English", "Computer Science", "Other"];
const initialRoutine: RoutineItem[] = [
  { id: "morning-revision", title: "Quick formula revision", time: "Before school", doneDates: [] },
  { id: "physics-practice", title: "Physics numericals", time: "After school", doneDates: [] },
  { id: "chemistry-recall", title: "Chemistry concepts & reactions", time: "Evening", doneDates: [] },
  { id: "maths-practice", title: "Mathematics problem practice", time: "Evening", doneDates: [] },
  { id: "daily-recap", title: "15-minute daily recap", time: "Before bed", doneDates: [] },
];
const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
};
const dateLabel = (value: string) => value
  ? new Date(value + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
  : "No deadline";
const googleEventDateKey = (event: GoogleCalendarEvent) => event.start?.date
  || (event.start?.dateTime ? localDateKey(new Date(event.start.dateTime)) : "");
const googleEventTimeLabel = (event: GoogleCalendarEvent) => event.start?.dateTime
  ? new Date(event.start.dateTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  : "All day";
const routineScheduleLabel = (days?: number[]) => {
  if (!days || days.length === 7) return "Every day";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .filter((_, index) => days.includes(index)).join(" · ") || "No days selected";
};
const routineIsScheduled = (item: RoutineItem, dateKey: string) =>
  !item.days || item.days.includes(new Date(dateKey + "T00:00:00").getDay());
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
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [profilePhotoDraft, setProfilePhotoDraft] = useState("");
  const [profilePhotoLoadError, setProfilePhotoLoadError] = useState(false);
  const [profilePhotoHelpOpen, setProfilePhotoHelpOpen] = useState(false);
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
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [swipeX, setSwipeX] = useState<number | null>(null);
  const [swipeY, setSwipeY] = useState<number | null>(null);
  const [groupPanel, setGroupPanel] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [inboxMode, setInboxMode] = useState<"direct" | "group">("direct");
  const [inboxSearch, setInboxSearch] = useState("");
  const [plannerView, setPlannerView] = useState<PlannerView>("overview");
  const [plannerTasks, setPlannerTasks] = useState<PlannerTask[]>([]);
  const [routineItems, setRoutineItems] = useState<RoutineItem[]>(initialRoutine);
  const [plannerLoaded, setPlannerLoaded] = useState(false);
  const [plannerTitle, setPlannerTitle] = useState("");
  const [plannerSubject, setPlannerSubject] = useState("Physics");
  const [plannerDueDate, setPlannerDueDate] = useState(localDateKey(new Date()));
  const [plannerPriority, setPlannerPriority] = useState<PlannerTask["priority"]>("medium");
  const [plannerMonth, setPlannerMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [plannerSelectedDate, setPlannerSelectedDate] = useState(localDateKey(new Date()));
  const [routineFormOpen, setRoutineFormOpen] = useState(false);
  const [routineEditingId, setRoutineEditingId] = useState<string | null>(null);
  const [routineTitle, setRoutineTitle] = useState("");
  const [routineTime, setRoutineTime] = useState("After school");
  const [routineDays, setRoutineDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [googleCalendarToken, setGoogleCalendarToken] = useState("");
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(false);
  const [googleCalendarRefresh, setGoogleCalendarRefresh] = useState(0);
  const googleCalendarClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

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

  useEffect(() => {
    if (!user?.uid) {
      setProfilePhotoUrl("");
      setProfilePhotoDraft("");
      setProfilePhotoLoadError(false);
      return;
    }
    const saved = window.localStorage.getItem("melo-profile-photo:" + user.uid) || "";
    setProfilePhotoUrl(saved);
    setProfilePhotoDraft(saved);
    setProfilePhotoLoadError(false);
  }, [user?.uid]);

  useEffect(() => {
    if (document.querySelector('script[data-melo-google-identity="true"]')) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.meloGoogleIdentity = "true";
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setPlannerTasks([]);
      setRoutineItems(initialRoutine);
      setPlannerLoaded(false);
      return;
    }
    try {
      const taskData = window.localStorage.getItem("melo-planner-tasks:" + user.uid);
      const routineData = window.localStorage.getItem("melo-planner-routine:" + user.uid);
      setPlannerTasks(taskData ? JSON.parse(taskData) as PlannerTask[] : []);
      setRoutineItems(routineData ? JSON.parse(routineData) as RoutineItem[] : initialRoutine);
    } catch (error) {
      console.error("Planner local data:", error);
      setPlannerTasks([]);
      setRoutineItems(initialRoutine);
    }
    setPlannerLoaded(true);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !plannerLoaded) return;
    window.localStorage.setItem("melo-planner-tasks:" + user.uid, JSON.stringify(plannerTasks));
  }, [plannerTasks, plannerLoaded, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !plannerLoaded) return;
    window.localStorage.setItem("melo-planner-routine:" + user.uid, JSON.stringify(routineItems));
  }, [routineItems, plannerLoaded, user?.uid]);

  useEffect(() => {
    if (!googleCalendarToken) {
      setGoogleCalendarEvents([]);
      setGoogleCalendarLoading(false);
      return;
    }
    let cancelled = false;
    async function loadGoogleCalendarEvents() {
      setGoogleCalendarLoading(true);
      const from = new Date(plannerMonth.getFullYear(), plannerMonth.getMonth(), 1);
      from.setDate(from.getDate() - 7);
      const until = new Date(plannerMonth.getFullYear(), plannerMonth.getMonth() + 1, 8);
      const params = new URLSearchParams({
        timeMin: from.toISOString(),
        timeMax: until.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      try {
        const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + params.toString(), {
          headers: { Authorization: "Bearer " + googleCalendarToken },
        });
        const payload = await response.json() as { items?: GoogleCalendarEvent[]; error?: { message?: string } };
        if (!response.ok) {
          if (response.status === 401) setGoogleCalendarToken("");
          throw new Error(payload.error?.message || "Google Calendar could not be loaded.");
        }
        if (!cancelled) setGoogleCalendarEvents((payload.items || []).filter((event) => event.status !== "cancelled"));
      } catch (error) {
        if (!cancelled) {
          console.error("Google Calendar:", error);
          setNotice(error instanceof Error ? error.message : "Google Calendar could not be loaded.");
        }
      } finally {
        if (!cancelled) setGoogleCalendarLoading(false);
      }
    }
    void loadGoogleCalendarEvents();
    return () => { cancelled = true; };
  }, [googleCalendarToken, googleCalendarRefresh, plannerMonth]);

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
    setAttachmentOpen(false);
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

  const todayKey = localDateKey(new Date());
  const pendingTasks = plannerTasks.filter((task) => !task.done);
  const completedTasks = plannerTasks.filter((task) => task.done);
  const overdueTasks = pendingTasks.filter((task) => task.dueDate && task.dueDate < todayKey);
  const upcomingTasks = pendingTasks
    .filter((task) => !task.dueDate || task.dueDate >= todayKey)
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"))
    .slice(0, 4);
  const todayRoutineItems = routineItems.filter((item) => routineIsScheduled(item, todayKey));
  const todayRoutineDone = todayRoutineItems.filter((item) => item.doneDates.includes(todayKey)).length;
  const selectedDateRoutines = routineItems.filter((item) => routineIsScheduled(item, plannerSelectedDate));
  const selectedDateGoogleEvents = googleCalendarEvents.filter((event) => googleEventDateKey(event) === plannerSelectedDate);

  function addPlannerTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = plannerTitle.trim();
    if (!title) return;
    setPlannerTasks((current) => [{
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : String(Date.now()),
      title,
      subject: plannerSubject,
      dueDate: plannerDueDate,
      priority: plannerPriority,
      done: false,
      createdAt: Date.now(),
    }, ...current]);
    setPlannerTitle("");
    setNotice("Task added to your study planner.");
  }

  function togglePlannerTask(id: string) {
    setPlannerTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task));
  }

  function deletePlannerTask(id: string) {
    setPlannerTasks((current) => current.filter((task) => task.id !== id));
  }

  function toggleRoutineItem(id: string, dateKey = todayKey) {
    setRoutineItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        doneDates: item.doneDates.includes(dateKey)
          ? item.doneDates.filter((date) => date !== dateKey)
          : [...item.doneDates, dateKey],
      };
    }));
  }

  function openRoutineForm(item?: RoutineItem) {
    if (item) {
      setRoutineEditingId(item.id);
      setRoutineTitle(item.title);
      setRoutineTime(item.time || "");
      setRoutineDays(item.days ? [...item.days] : [0, 1, 2, 3, 4, 5, 6]);
    } else {
      setRoutineEditingId(null);
      setRoutineTitle("");
      setRoutineTime("After school");
      setRoutineDays([1, 2, 3, 4, 5]);
    }
    setRoutineFormOpen(true);
  }

  function saveRoutineItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = routineTitle.trim();
    if (!title) return;
    if (!routineDays.length) {
      setNotice("Choose at least one day for this routine.");
      return;
    }
    const updated = { title, time: routineTime.trim() || "Any time", days: [...routineDays].sort((a, b) => a - b) };
    if (routineEditingId) {
      setRoutineItems((current) => current.map((item) => item.id === routineEditingId ? { ...item, ...updated } : item));
      setNotice("Routine updated.");
    } else {
      setRoutineItems((current) => [{
        id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : String(Date.now()),
        ...updated,
        doneDates: [],
      }, ...current]);
      setNotice("Your new routine has been added.");
    }
    setRoutineFormOpen(false);
    setRoutineEditingId(null);
  }

  function deleteRoutineItem(id: string) {
    setRoutineItems((current) => current.filter((item) => item.id !== id));
    if (routineEditingId === id) setRoutineFormOpen(false);
    setNotice("Routine removed.");
  }

  function connectGoogleCalendar() {
    if (!googleCalendarClientId) {
      setNotice("Google Calendar setup is incomplete. Add VITE_GOOGLE_CLIENT_ID under GitHub repository Settings → Secrets and variables → Actions → Variables.");
      return;
    }
    const oauth = window.google?.accounts?.oauth2;
    if (!oauth) {
      setNotice("Google sign-in is still loading. Please try Connect again in a moment.");
      return;
    }
    try {
      const client = oauth.initTokenClient({
        client_id: googleCalendarClientId,
        scope: "https://www.googleapis.com/auth/calendar.events",
        callback: (response) => {
          if (!response.access_token || response.error) {
            setNotice(response.error_description || "Google Calendar access was not granted.");
            return;
          }
          setGoogleCalendarToken(response.access_token);
          setNotice("Google Calendar connected for this session.");
        },
        error_callback: (error) => {
          setNotice(error.message || "Google sign-in could not be opened. Try again.");
        },
      });
      client.requestAccessToken({ prompt: googleCalendarToken ? "" : "consent" });
    } catch (error) {
      console.error("Google Calendar authorization:", error);
      setNotice("Google Calendar could not be connected. Check your OAuth settings.");
    }
  }

  function disconnectGoogleCalendar() {
    const revoke = window.google?.accounts?.oauth2?.revoke;
    if (googleCalendarToken && revoke) revoke(googleCalendarToken, () => {});
    setGoogleCalendarToken("");
    setGoogleCalendarEvents([]);
    setNotice("Google Calendar disconnected from this session.");
  }

  async function addPlannerTaskToGoogle(task: PlannerTask) {
    if (!googleCalendarToken) {
      setNotice("Connect Google Calendar before syncing a task.");
      return;
    }
    if (!task.dueDate) {
      setNotice("Add a deadline to this task before sending it to Google Calendar.");
      return;
    }
    const nextDay = new Date(task.dueDate + "T00:00:00");
    nextDay.setDate(nextDay.getDate() + 1);
    const eventBody = {
      summary: task.title,
      description: "AX Study Space · " + task.subject + " · " + task.priority + " priority",
      start: { date: task.dueDate },
      end: { date: localDateKey(nextDay) },
    };
    const endpoint = task.googleEventId
      ? "https://www.googleapis.com/calendar/v3/calendars/primary/events/" + encodeURIComponent(task.googleEventId)
      : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    try {
      let response = await fetch(endpoint, {
        method: task.googleEventId ? "PUT" : "POST",
        headers: {
          Authorization: "Bearer " + googleCalendarToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      });
      if (response.status === 401) {
        setGoogleCalendarToken("");
        setNotice("Your Google access expired. Reconnect Google Calendar and try again.");
        return;
      }
      if (response.status === 404 && task.googleEventId) {
        response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + googleCalendarToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
        });
      }
      const payload = await response.json() as GoogleCalendarEvent & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "The task could not be added to Google Calendar.");
      setPlannerTasks((current) => current.map((item) => item.id === task.id ? { ...item, googleEventId: payload.id } : item));
      setGoogleCalendarEvents((current) => [...current.filter((item) => item.id !== payload.id), payload]);
      setNotice("Task added to Google Calendar.");
    } catch (error) {
      console.error("Google Calendar task sync:", error);
      setNotice(error instanceof Error ? error.message : "The task could not be synced.");
    }
  }

  const plannerMonthDays = (() => {
    const firstDay = new Date(plannerMonth.getFullYear(), plannerMonth.getMonth(), 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const count = new Date(plannerMonth.getFullYear(), plannerMonth.getMonth() + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  })();
  const selectedDateTasks = plannerTasks.filter((task) => task.dueDate === plannerSelectedDate);

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

  const saveProfilePhoto = () => {
    if (!user) return;
    const value = profilePhotoDraft.trim();
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:") throw new Error("HTTPS required");
      } catch {
        setNotice("Enter a valid image URL beginning with https://.");
        return;
      }
    }
    const key = "melo-profile-photo:" + user.uid;
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
    setProfilePhotoUrl(value);
    setProfilePhotoLoadError(false);
    setNotice(value
      ? "Profile photo saved on this device."
      : "Custom profile photo removed.");
  };

  const ownPhotoUrl = profilePhotoUrl || user?.photoURL || "";

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
    {!active && tab === "home" ? (
      <header className="top top-logo-only"><div className="brand">melo<span>.</span></div></header>
    ) : null}
    {notice ? <button className="noticebar" onClick={() => setNotice("")}>{notice}<b>×</b></button> : null}

    {active ? <section className="conversation">
      {chatPanel === "chat" ? <>
        <header className="conversation-head">
          <button className="back chat-back" onClick={() => setActive(null)} aria-label="Back to chats">‹</button>
          <button className="chat-person-trigger" onClick={() => setChatPanel("details")} aria-label="Conversation details">
            <span className={"avatar chat-header-avatar " + (active.type === "group" ? "group-avatar" : "")}>{active.type === "group" ? "✳" : initials(titleOf(active))}</span>
            <span className="conversation-title"><strong>{titleOf(active)}</strong><small>{active.demo ? "Sample · This device only" : active.type === "group" ? active.memberIds.length + " members · Private group" : "Private conversation"}</small></span>
          </button>
          <button className="chat-more" onClick={() => setChatPanel("details")} aria-label="Conversation info">···</button>
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
        {attachmentOpen && <div className="attachment-sheet" role="dialog" aria-label="Attachments">
          {[
            ["▧", "Photos"], ["◎", "Camera"], ["▤", "Files"], ["GIF", "GIFs"],
          ].map(([icon, label]) => <button key={label} type="button" onClick={() => { setAttachmentOpen(false); setNotice("Media sharing is not enabled in Melo yet."); }}>
            <span>{icon}</span>{label}
          </button>)}
        </div>}
        <form className="composer" autoComplete="off" onSubmit={sendMessage}>
          <button className="attach-button" type="button" aria-label="Add attachment" onClick={() => setAttachmentOpen((open) => !open)}>{attachmentOpen ? "×" : "+"}</button>
          <input type="text" autoComplete="new-password" autoCorrect="off" autoCapitalize="sentences" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message" maxLength={4000} />
          <button className="send" disabled={busy || !draft.trim()} aria-label="Send message">↑</button>
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
      <section className={"content " + (tab === "chats" ? "inbox-content" : "")} key={tab}>
        {tab === "home" && <div className="heading">
          <div><small>MELO · {label.toUpperCase()}</small><h1>{tab === "home" ? "Your circle" : label}</h1></div>
          {tab === "home" && <div className="avatar">{initials(user?.displayName || "M")}</div>}
        </div>}

        {tab === "home" && <div className="student-planner">
          <section className="planner-welcome">
            <div className="planner-welcome-top"><span>AX STUDY SPACE · CLASS XI</span><span className="planner-live-dot">● YOUR PLAN</span></div>
            <h2>Make today<br/><em>count.</em></h2>
            <p>A calmer way to stay ahead of school, one focused step at a time.</p>
            <div className="planner-welcome-stats">
              <div><strong>{pendingTasks.length}</strong><small>To do</small></div>
              <i />
              <div><strong>{overdueTasks.length}</strong><small>Overdue</small></div>
              <i />
              <div><strong>{completedTasks.length}</strong><small>Completed</small></div>
            </div>
          </section>

          <div className="planner-subnav" role="tablist" aria-label="Study planner sections">
            {([
              ["overview", "Today", "⌂"],
              ["tasks", "Tasks", "✓"],
              ["calendar", "Calendar", "▦"],
              ["routine", "Routine", "◷"],
              ["progress", "Progress", "↗"],
            ] as [PlannerView, string, string][]).map(([view, title, icon]) =>
              <button key={view} role="tab" aria-selected={plannerView === view}
                className={plannerView === view ? "selected" : ""}
                onClick={() => setPlannerView(view)}>
                <span>{icon}</span><small>{title}</small>
              </button>
            )}
          </div>

          {plannerView === "overview" && <>
            <div className="planner-greeting-row">
              <div><small>{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</small><h3>Your study dashboard</h3></div>
              <button className="planner-add-mini" onClick={() => setPlannerView("tasks")}>＋ Add task</button>
            </div>
            <div className="planner-focus-card">
              <div><span className="planner-card-kicker">TODAY'S FOCUS</span><h3>{overdueTasks.length ? "Clear the backlog" : pendingTasks.length ? "One task at a time" : "A fresh page awaits"}</h3><p>{overdueTasks.length ? overdueTasks.length + " overdue item(s) need your attention." : pendingTasks.length ? "Pick a priority and give it your best focused effort." : "Add your first assignment, revision target or test date."}</p></div>
              <div className="planner-focus-ring"><strong>{plannerTasks.length ? Math.round(completedTasks.length / plannerTasks.length * 100) : 0}%</strong><small>done</small></div>
            </div>
            <div className="planner-section-head"><h3>Upcoming deadlines</h3><button onClick={() => setPlannerView("tasks")}>All tasks ↗</button></div>
            {overdueTasks.slice(0,2).map((task) => <div className="planner-task-row overdue" key={task.id}>
              <button className="planner-check" onClick={() => togglePlannerTask(task.id)} aria-label="Mark complete" />
              <div className="planner-task-copy"><strong>{task.title}</strong><small>{task.subject} · Overdue</small></div><span className="planner-due-label">Late</span>
            </div>)}
            {upcomingTasks.map((task) => <div className="planner-task-row" key={task.id}>
              <button className="planner-check" onClick={() => togglePlannerTask(task.id)} aria-label="Mark complete" />
              <div className="planner-task-copy"><strong>{task.title}</strong><small>{task.subject} · {task.dueDate === todayKey ? "Due today" : dateLabel(task.dueDate)}</small></div><span className={"planner-priority " + task.priority}>{task.priority}</span>
            </div>)}
            {!overdueTasks.length && !upcomingTasks.length && <div className="planner-empty"><span>✦</span><strong>Your schedule is clear.</strong><small>Add a task to start planning your week.</small></div>}
            <div className="planner-quick-grid">
              <button onClick={() => setPlannerView("calendar")}><span>▦</span><strong>Plan your month</strong><small>Tests, submissions & events</small></button>
              <button onClick={() => setPlannerView("routine")}><span>◷</span><strong>Build consistency</strong><small>{todayRoutineDone}/{routineItems.length} daily habits done</small></button>
            </div>
          </>}

          {plannerView === "tasks" && <>
            <div className="planner-greeting-row"><div><small>PLAN · PRIORITISE · FINISH</small><h3>Your task list</h3></div><span className="planner-count-pill">{pendingTasks.length} active</span></div>
            <form className="planner-task-form" onSubmit={addPlannerTask}>
              <label>What needs to get done?<input value={plannerTitle} onChange={(event) => setPlannerTitle(event.target.value)} placeholder="e.g. Complete Motion in a Plane numericals" maxLength={100} required /></label>
              <div className="planner-form-grid">
                <label>Subject<select value={plannerSubject} onChange={(event) => setPlannerSubject(event.target.value)}>{plannerSubjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
                <label>Deadline<input type="date" value={plannerDueDate} onChange={(event) => setPlannerDueDate(event.target.value)} /></label>
              </div>
              <div className="planner-form-bottom"><label>Priority<select value={plannerPriority} onChange={(event) => setPlannerPriority(event.target.value as PlannerTask["priority"])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><button className="planner-submit" type="submit">＋ Add to planner</button></div>
            </form>
            <div className="planner-section-head"><h3>Active work</h3><small>{pendingTasks.length} remaining</small></div>
            {pendingTasks.slice().sort((a,b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).map((task) => <div className={"planner-task-row " + (task.dueDate && task.dueDate < todayKey ? "overdue" : "")} key={task.id}>
              <button className="planner-check" onClick={() => togglePlannerTask(task.id)} aria-label="Mark complete" />
              <div className="planner-task-copy"><strong>{task.title}</strong><small>{task.subject} · {task.dueDate ? dateLabel(task.dueDate) : "No deadline"}</small></div><span className={"planner-priority " + task.priority}>{task.priority}</span>{googleCalendarToken && task.dueDate && <button type="button" className="planner-google-mini" onClick={() => void addPlannerTaskToGoogle(task)}>{task.googleEventId ? "Update in Google" : "Add to Google"}</button>}<button className="planner-delete" onClick={() => deletePlannerTask(task.id)} aria-label="Delete task">×</button>
            </div>)}
            {!pendingTasks.length && <div className="planner-empty"><span>✓</span><strong>Nothing pending.</strong><small>Enjoy the breathing room or add a new task.</small></div>}
            {completedTasks.length > 0 && <><div className="planner-section-head"><h3>Completed</h3><small>{completedTasks.length}</small></div>{completedTasks.map((task) => <div className="planner-task-row completed" key={task.id}><button className="planner-check checked" onClick={() => togglePlannerTask(task.id)} aria-label="Reopen task">✓</button><div className="planner-task-copy"><strong>{task.title}</strong><small>{task.subject} · Completed</small></div><button className="planner-delete" onClick={() => deletePlannerTask(task.id)} aria-label="Delete task">×</button></div>)}</>}
          </>}

          {plannerView === "calendar" && <>
            <div className="planner-greeting-row"><div><small>YOUR SCHEDULE, IN ONE PLACE</small><h3>Calendar</h3></div><span className="planner-count-pill">{plannerTasks.length + googleCalendarEvents.length} events</span></div>
            <section className="planner-google-panel">
              <div className="planner-google-brand"><span className="planner-google-mark">G</span><span><strong>Google Calendar</strong><small>{googleCalendarToken ? "Connected for this session" : "Bring your schedules together"}</small></span></div>
              <div className="planner-google-actions">
                {googleCalendarToken ? <>
                  <button type="button" onClick={() => setGoogleCalendarRefresh((value) => value + 1)} disabled={googleCalendarLoading}>{googleCalendarLoading ? "Syncing…" : "↻ Sync now"}</button>
                  <button type="button" className="subtle" onClick={disconnectGoogleCalendar}>Disconnect</button>
                </> : <button type="button" onClick={connectGoogleCalendar}>Connect Google Calendar ↗</button>}
              </div>
              {!googleCalendarClientId && <small className="planner-google-help">Setup needed: add <b>VITE_GOOGLE_CLIENT_ID</b> as a GitHub Actions repository variable to enable connection.</small>}
              {googleCalendarToken && <small className="planner-google-help">Google events appear here. Dated Melo tasks can be added to your Google Calendar from the agenda.</small>}
            </section>
            <section className="planner-calendar-card">
              <div className="planner-calendar-heading"><span><small>MONTH VIEW</small><strong>{plannerMonth.toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong></span><button type="button" onClick={() => {setPlannerMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));setPlannerSelectedDate(todayKey);}}>Today</button></div>
              <div className="planner-calendar-top"><button type="button" aria-label="Previous month" onClick={() => setPlannerMonth(new Date(plannerMonth.getFullYear(), plannerMonth.getMonth()-1,1))}>‹</button><span>Choose a day</span><button type="button" aria-label="Next month" onClick={() => setPlannerMonth(new Date(plannerMonth.getFullYear(),plannerMonth.getMonth()+1,1))}>›</button></div>
              <div className="planner-calendar-grid">{["MON","TUE","WED","THU","FRI","SAT","SUN"].map((day,index)=><small key={day+index}>{day}</small>)}
                {plannerMonthDays.map((day,index) => {
                  if (!day) return <span className="planner-calendar-blank" key={"blank-"+index}/>;
                  const dateKey = localDateKey(new Date(plannerMonth.getFullYear(),plannerMonth.getMonth(),day));
                  const hasTask = plannerTasks.some((task) => task.dueDate === dateKey && !task.done);
                  const hasGoogleEvent = googleCalendarEvents.some((event) => googleEventDateKey(event) === dateKey);
                  const hasRoutine = routineItems.some((item) => routineIsScheduled(item, dateKey));
                  return <button type="button" key={dateKey} className={(plannerSelectedDate === dateKey ? "selected " : "") + (dateKey === todayKey ? "today " : "") + (hasTask ? "has-task " : "") + (hasGoogleEvent ? "has-google " : "") + (hasRoutine ? "has-routine" : "")} onClick={() => setPlannerSelectedDate(dateKey)}>
                    <span className="planner-calendar-day-number">{day}</span>
                    <span className="planner-calendar-dots">{hasTask && <i className="task-dot"/>}{hasGoogleEvent && <i className="google-dot"/>}{hasRoutine && <i className="routine-dot"/>}</span>
                  </button>;
                })}
              </div>
              <div className="planner-calendar-legend"><span><i className="task-dot"/> Melo tasks</span><span><i className="google-dot"/> Google events</span><span><i className="routine-dot"/> Routines</span></div>
            </section>
            <div className="planner-agenda-head"><div><small>DAY AGENDA</small><h3>{new Date(plannerSelectedDate + "T00:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"})}</h3></div><button type="button" onClick={() => {setPlannerDueDate(plannerSelectedDate);setPlannerView("tasks");}}>＋ Add task</button></div>
            <div className="planner-agenda-section">
              <div className="planner-section-head"><h3>Melo tasks</h3><small>{selectedDateTasks.length}</small></div>
              {selectedDateTasks.length ? selectedDateTasks.map((task)=><div className={"planner-task-row "+(task.done?"completed":"")} key={task.id}>
                <button className={"planner-check "+(task.done?"checked":"")} onClick={()=>togglePlannerTask(task.id)} aria-label={task.done?"Reopen task":"Complete task"}>{task.done?"✓":""}</button>
                <div className="planner-task-copy"><strong>{task.title}</strong><small>{task.subject} · {task.done?"Completed":task.priority+" priority"}</small></div>
                {googleCalendarToken && <button type="button" className="planner-google-mini" onClick={() => void addPlannerTaskToGoogle(task)}>{task.googleEventId ? "Update in Google" : "Add to Google"}</button>}
              </div>) : <div className="planner-empty"><span>◷</span><strong>No Melo tasks planned.</strong><small>Add a task to keep this day on track.</small></div>}
            </div>
            <div className="planner-agenda-section">
              <div className="planner-section-head"><h3>Google Calendar</h3><small>{selectedDateGoogleEvents.length}{googleCalendarLoading ? " · syncing" : ""}</small></div>
              {selectedDateGoogleEvents.length ? selectedDateGoogleEvents.map((event)=><div className="planner-google-event" key={event.id}>
                <span className="planner-google-event-time">{googleEventTimeLabel(event)}</span><div><strong>{event.summary || "Untitled event"}</strong><small>Google Calendar</small></div>{event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer">Open ↗</a>}
              </div>) : <div className="planner-empty planner-empty-compact"><span>G</span><strong>{googleCalendarToken ? "No Google events on this day." : "Connect Google Calendar to see your events."}</strong><small>{googleCalendarToken ? "Your other calendar events will appear here." : "Your Google events stay separate from your Melo tasks."}</small></div>}
            </div>
            <div className="planner-agenda-section">
              <div className="planner-section-head"><h3>Scheduled routines</h3><small>{selectedDateRoutines.length}</small></div>
              {selectedDateRoutines.length ? selectedDateRoutines.map((item)=><div className={"planner-routine-row planner-agenda-routine "+(item.doneDates.includes(plannerSelectedDate)?"done":"")} key={item.id}>
                <button type="button" className="planner-routine-check" onClick={() => toggleRoutineItem(item.id, plannerSelectedDate)}>{item.doneDates.includes(plannerSelectedDate)?"✓":""}</button>
                <span className="planner-routine-copy"><strong>{item.title}</strong><small>{item.time}</small></span><b>{item.doneDates.includes(plannerSelectedDate)?"Done":"Routine"}</b>
              </div>) : <div className="planner-empty planner-empty-compact"><span>◷</span><strong>No routines scheduled.</strong><small>You can build your own routine in the Routine tab.</small></div>}
            </div>
          </>}

          {plannerView === "routine" && <>
            <div className="planner-greeting-row"><div><small>BUILD A ROUTINE THAT FITS YOU</small><h3>Your routines</h3></div><button type="button" className="planner-add-mini" onClick={() => openRoutineForm()}>＋ Create routine</button></div>
            <div className="planner-routine-hero"><strong>{Math.round(todayRoutineDone/Math.max(1,todayRoutineItems.length)*100)}%</strong><span>{todayRoutineDone} of {todayRoutineItems.length} routines completed today</span><div><i style={{width:(todayRoutineDone/Math.max(1,todayRoutineItems.length)*100)+"%"}}/></div></div>
            {routineFormOpen && <form className="planner-routine-form" onSubmit={saveRoutineItem}>
              <div className="planner-routine-form-heading"><strong>{routineEditingId ? "Edit routine" : "Create a routine"}</strong><small>Set a time and choose the days it repeats.</small></div>
              <label>Routine name<input value={routineTitle} onChange={(event) => setRoutineTitle(event.target.value)} placeholder="e.g. Revise Physics formulas" maxLength={70} required /></label>
              <label>Time or reminder<input value={routineTime} onChange={(event) => setRoutineTime(event.target.value)} placeholder="e.g. 6:30 PM · After school" maxLength={50} /></label>
              <fieldset><legend>Repeat on</legend><div className="planner-weekday-picker">
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day,index)=><label key={day} className={routineDays.includes(index)?"picked":""}><input type="checkbox" checked={routineDays.includes(index)} onChange={(event)=>setRoutineDays((current)=>event.target.checked?[...current,index]:current.filter((value)=>value!==index))}/><span>{day}</span></label>)}
              </div></fieldset>
              <div className="planner-routine-form-actions"><button type="button" className="planner-routine-cancel" onClick={() => setRoutineFormOpen(false)}>Cancel</button><button className="planner-submit" type="submit">{routineEditingId ? "Save changes" : "Create routine"}</button></div>
            </form>}
            <div className="planner-section-head"><h3>Routine library</h3><small>{routineItems.length} saved</small></div>
            {routineItems.length ? routineItems.map((item)=>{
              const scheduledToday = routineIsScheduled(item,todayKey);
              const doneToday = scheduledToday && item.doneDates.includes(todayKey);
              return <div key={item.id} className={"planner-routine-row planner-routine-manage "+(doneToday?"done":"")}>
                <button type="button" disabled={!scheduledToday} className="planner-routine-check" onClick={()=>toggleRoutineItem(item.id)} aria-label={doneToday?"Mark not done":"Mark routine done"}>{doneToday?"✓":""}</button>
                <span className="planner-routine-copy"><strong>{item.title}</strong><small>{item.time} · {routineScheduleLabel(item.days)}</small></span>
                <b>{scheduledToday?(doneToday?"Done":"Today"):"Other days"}</b>
                <button type="button" className="planner-routine-edit" onClick={()=>openRoutineForm(item)} aria-label={"Edit "+item.title}>Edit</button>
                <button type="button" className="planner-routine-remove" onClick={()=>deleteRoutineItem(item.id)} aria-label={"Delete "+item.title}>×</button>
              </div>;
            }) : <div className="planner-empty"><span>◷</span><strong>No routines yet.</strong><small>Create your first routine and make it yours.</small></div>}
            <p className="planner-helper-note">Create as many routines as you need, choose the days they repeat, and check them off as you go. Your routine is saved on this device.</p>
          </>}

          {plannerView === "progress" && <>
            <div className="planner-greeting-row"><div><small>YOUR EFFORT, MADE VISIBLE</small><h3>Study progress</h3></div><span className="planner-count-pill">Class XI</span></div>
            <div className="planner-progress-hero"><strong>{plannerTasks.length ? Math.round(completedTasks.length/plannerTasks.length*100):0}%</strong><span>tasks completed</span><div><i style={{width:(plannerTasks.length?completedTasks.length/plannerTasks.length*100:0)+"%"}}/></div></div>
            <div className="planner-progress-grid"><div><strong>{completedTasks.length}</strong><small>Finished</small></div><div><strong>{pendingTasks.length}</strong><small>In progress</small></div><div><strong>{overdueTasks.length}</strong><small>Overdue</small></div></div>
            <div className="planner-section-head"><h3>Subject workload</h3><small>Tasks you've added</small></div>
            {plannerSubjects.slice(0,5).map((subject)=>{const count=plannerTasks.filter((task)=>task.subject===subject).length;const done=plannerTasks.filter((task)=>task.subject===subject&&task.done).length;return <div className="planner-subject-progress" key={subject}><div><strong>{subject}</strong><small>{done}/{count} done</small></div><span><i style={{width:(count?done/count*100:0)+"%"}}/></span></div>;})}
          </>}
        </div>}
        {tab === "chats" && <>
          <section className="inbox-hero">
            <div className="inbox-hero-top">
              <div className="inbox-hero-copy">
                <small>AX · MELO PRIVATE NETWORK</small>
                <h1>Good to see you, {(user?.displayName || "there").split(" ")[0]}.</h1>
                <p>Your circle. Your space. Always connected.</p>
              </div>
              <div className="inbox-hero-mark ax-inbox-mark" aria-label="AX"><span>AX</span></div>
            </div>
            <div className="inbox-contacts-heading">
              <span>CONTACT LIST</span><small>{members.length + 1} members</small>
            </div>
            <div className="inbox-contacts-strip">
              <div className="inbox-contact inbox-contact-you">
                <span className="avatar inbox-contact-avatar own">
                  {ownPhotoUrl && !profilePhotoLoadError ? <img src={ownPhotoUrl} alt="" onError={() => setProfilePhotoLoadError(true)} /> : initials(user?.displayName || "M")}
                </span>
                <small>You</small>
              </div>
              {ordered.map((member) => <button className="inbox-contact" key={member.uid} onClick={() => openDirect(member)}>
                <span className="avatar inbox-contact-avatar">
                  {member.photoURL ? <img src={member.photoURL} alt="" /> : initials(nameOf(member))}
                </span>
                <small>{nameOf(member).split(" ")[0]}</small>
              </button>)}
            </div>
          </section>

          <section className="inbox-sheet">
            <div className="inbox-search">
              <span aria-hidden="true">⌕</span>
              <input value={inboxSearch} onChange={(event) => setInboxSearch(event.target.value)}
                placeholder="Search conversations or people…" aria-label="Search conversations or people" />
              {inboxSearch && <button type="button" onClick={() => setInboxSearch("")} aria-label="Clear search">×</button>}
            </div>

            <div className="inbox-mode-switch" role="tablist" aria-label="Conversation type">
              <button type="button" role="tab" aria-selected={inboxMode === "direct"}
                className={inboxMode === "direct" ? "active" : ""}
                onClick={() => setInboxMode("direct")}>
                Direct Message <span>{inbox.filter((item) => item.type === "direct").length + demoConversations.filter((item) => item.type === "direct").length}</span>
              </button>
              <button type="button" role="tab" aria-selected={inboxMode === "group"}
                className={inboxMode === "group" ? "active" : ""}
                onClick={() => setInboxMode("group")}>
                Groups <span>{inbox.filter((item) => item.type === "group").length + demoConversations.filter((item) => item.type === "group").length}</span>
              </button>
            </div>

            {groupPanel && <form className="group-panel inbox-group-panel" onSubmit={createGroup}>
              <label>Group name<input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="e.g. Weekend plans" maxLength={40} required /></label>
              <div className="group-panel-label">Choose 1–3 friends <span>{selectedMembers.length}/3</span></div>
              <div className="group-picks">{ordered.map((member) => <label className="group-pick" key={member.uid}>
                <input type="checkbox" checked={selectedMembers.includes(member.uid)}
                  disabled={!selectedMembers.includes(member.uid) && selectedMembers.length >= 3}
                  onChange={(event) => setSelectedMembers((current) => event.target.checked
                    ? [...current, member.uid] : current.filter((id) => id !== member.uid))} />
                <span className="avatar">{member.photoURL ? <img src={member.photoURL} alt="" /> : initials(nameOf(member))}</span><span>{nameOf(member)}</span>
              </label>)}</div>
              <div className="group-panel-buttons">
                <button type="button" className="secondary" onClick={() => setGroupPanel(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={busy || selectedMembers.length < 1 || selectedMembers.length > 3}>Create group</button>
              </div>
            </form>}

            {fourReady && (inboxSearch.trim() === "" || "the four".includes(inboxSearch.trim().toLowerCase())) && <>
              <div className="inbox-section-title"><span>Pinned Message</span><small>1</small></div>
              <button className="inbox-row inbox-pinned-row" onClick={() => openConversation({
                id: "the-four", type: "group", title: "The Four",
                memberIds: [user!.uid, ...members.map((member) => member.uid)],
              })}>
                <div className="avatar inbox-row-avatar group-avatar">✳</div>
                <div className="inbox-row-copy"><strong>The Four</strong><small>All four of you · Permanent group</small></div>
                <span className="inbox-row-meta">Pinned</span>
              </button>
            </>}

            <div className="inbox-section-title">
              <span>{inboxMode === "direct" ? "All Messages" : "All Groups"}</span>
              <small>{inbox.filter((item) => item.id !== "the-four" && item.type === inboxMode
                && titleOf(item).toLowerCase().includes(inboxSearch.trim().toLowerCase())).length
                + demoConversations.filter((item) => item.type === inboxMode
                  && titleOf(item).toLowerCase().includes(inboxSearch.trim().toLowerCase())).length}</small>
            </div>

            <div className="inbox-list">
              {inbox.filter((conversation) => conversation.id !== "the-four"
                && conversation.type === inboxMode
                && titleOf(conversation).toLowerCase().includes(inboxSearch.trim().toLowerCase()))
                .map((conversation) => <button className="inbox-row" key={conversation.id} onClick={() => openConversation(conversation)}>
                  <div className={"avatar inbox-row-avatar " + (conversation.type === "group" ? "group-avatar" : "")}>
                    {conversation.type === "group" ? "✳" : initials(titleOf(conversation))}
                  </div>
                  <div className="inbox-row-copy">
                    <strong>{titleOf(conversation)}</strong>
                    <small>{conversation.type === "group"
                      ? conversation.memberIds.length + " members · Private group"
                      : "Private direct message"}</small>
                  </div>
                  <span className="inbox-row-arrow">›</span>
                </button>)}

              {demoReady && demoConversations.filter((conversation) => conversation.type === inboxMode
                && titleOf(conversation).toLowerCase().includes(inboxSearch.trim().toLowerCase())).map((conversation) => {
                const sampleMessages = demoMessages[conversation.id] || [];
                const latest = sampleMessages[sampleMessages.length - 1];
                return <button className="inbox-row" key={conversation.id} onClick={() => openConversation(conversation)}>
                  <div className={"avatar inbox-row-avatar " + (conversation.type === "group" ? "group-avatar" : "")}>
                    {conversation.type === "group" ? "✳" : initials(titleOf(conversation))}
                  </div>
                  <div className="inbox-row-copy">
                    <strong>{titleOf(conversation)}</strong>
                    <small>{latest ? (latest.uid === user?.uid ? "You: " : "") + latest.text : "Sample conversation"}</small>
                  </div>
                  <span className="inbox-local-tag">LOCAL</span>
                </button>;
              })}
              {!inbox.some((item) => item.id !== "the-four" && item.type === inboxMode
                && titleOf(item).toLowerCase().includes(inboxSearch.trim().toLowerCase()))
                && !demoConversations.some((item) => item.type === inboxMode
                  && titleOf(item).toLowerCase().includes(inboxSearch.trim().toLowerCase()))
                && !(inboxMode === "group" && fourReady && ("the four".includes(inboxSearch.trim().toLowerCase())))
                && <p className="inbox-empty">{inboxSearch.trim()
                  ? "No matches found. Try another name."
                  : inboxMode === "direct"
                    ? "No direct messages yet. Choose a contact above to start one."
                    : "No groups yet. Create a group for your circle."}</p>}
            </div>
            {demoReady && <p className="inbox-demo-note">Sample conversations are saved only on this device and are never sent to real members.</p>}
          </section>

          <button className="inbox-fab" type="button" aria-label="Create a group"
            onClick={() => { setInboxMode("group"); setGroupPanel((open) => !open); }}>
            {groupPanel ? "×" : "+"}
          </button>
        </>}

        {tab === "profile" && <div className={"profile-card profile-page " + (settingsOpen ? "profile-settings-view" : "")}>
          {!settingsOpen ? <>
            <section className="profile-cover">
              <div className="profile-cover-image">
                {ownPhotoUrl && !profilePhotoLoadError
                  ? <img src={ownPhotoUrl} alt={user?.displayName || "Profile photo"} onError={() => setProfilePhotoLoadError(true)} />
                  : <div className="profile-cover-fallback">{initials(user?.displayName || "M")}</div>}
              </div>
              <div className="profile-cover-overlay">
                <span>MELO · MEMBER PROFILE</span>
                <button className="profile-settings-button" type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>⚙</button>
              </div>
            </section>
            <section className="profile-identity">
              <div className="profile-name-row">
                <h1>{user?.displayName || "Melo member"}</h1>
                <span className="profile-verified" title="Approved member" aria-label="Approved member">✓</span>
              </div>
              <span className="profile-status">APPROVED MELO MEMBER</span>
              <p className="profile-bio">A member of your private circle. Here for the conversations and moments that matter.</p>
              <div className="profile-stats">
                <div><strong>{membersLoaded ? members.length + 1 : "—"}</strong><span>Circle members</span></div>
                <div><strong>{inbox.length}</strong><span>Conversations</span></div>
              </div>
              <button className="profile-edit-button" type="button" onClick={() => setSettingsOpen(true)}>Edit profile <span>↗</span></button>
            </section>
            <section className="profile-circle">
              <div className="profile-section-heading"><h2>Your Circle</h2><span>{membersLoaded ? members.length + 1 : "—"} members</span></div>
              <div className="profile-circle-grid">
                <div className="profile-circle-person">
                  <span className="avatar profile-circle-avatar">
                    {ownPhotoUrl && !profilePhotoLoadError
                      ? <img src={ownPhotoUrl} alt="" onError={() => setProfilePhotoLoadError(true)} />
                      : initials(user?.displayName || "M")}
                  </span>
                  <strong>{(user?.displayName || "You").split(" ")[0]}</strong><small>You</small>
                </div>
                {members.map((member) => <div className="profile-circle-person" key={member.uid}>
                  <span className="avatar profile-circle-avatar">
                    {member.photoURL
                      ? <img src={member.photoURL} alt="" />
                      : initials(nameOf(member))}
                  </span>
                  <strong>{nameOf(member).split(" ")[0]}</strong><small>Member</small>
                </div>)}
              </div>
            </section>
          </> : <>
            <div className="profile-settings-head">
              <button className="settings-back" type="button" onClick={() => setSettingsOpen(false)} aria-label="Back to profile">‹</button>
              <div><small>PERSONALIZE MELO</small><h2>Settings</h2></div>
            </div>
            <section className="settings-card profile-photo-settings" aria-labelledby="profile-photo-title">
              <div className="settings-heading">
                <div><small>PROFILE</small><h3 id="profile-photo-title">Profile photo</h3></div>
                <span className="settings-symbol" aria-hidden="true">◎</span>
              </div>
              <div className="profile-photo-setting-preview">
                <span className="avatar profile-photo-preview">
                  {profilePhotoUrl && !profilePhotoLoadError
                    ? <img src={profilePhotoUrl} alt="Profile preview" onError={() => setProfilePhotoLoadError(true)} />
                    : user?.photoURL && !profilePhotoLoadError
                      ? <img src={user.photoURL} alt="Profile preview" onError={() => setProfilePhotoLoadError(true)} />
                      : initials(user?.displayName || "M")}
                </span>
                <div><strong>{user?.displayName || "Melo member"}</strong><small>Preview of your profile picture</small></div>
              </div>
              <div className="profile-photo-label-row">
                <label className="profile-photo-label" htmlFor="profile-photo-url">Image URL</label>
                <button type="button" className="profile-photo-help-button"
                  aria-label="How to get an image link" aria-expanded={profilePhotoHelpOpen}
                  onClick={() => setProfilePhotoHelpOpen((open) => !open)}>ⓘ</button>
              </div>
              {profilePhotoHelpOpen && <div className="profile-photo-help">
                <strong>How to get your image link</strong>
                <p>Upload your picture to an image-hosting service, make it publicly viewable, then copy its <b>direct image link</b> (not the page's share link). Paste the link here. It should start with <b>https://</b>.</p>
              </div>}
              <input id="profile-photo-url" className="profile-photo-input" type="url"
                value={profilePhotoDraft} onChange={(event) => {
                  setProfilePhotoDraft(event.target.value);
                  setProfilePhotoLoadError(false);
                }}
                placeholder="https://example.com/photo.jpg" autoComplete="url" />
              <p>Use a direct HTTPS link to an image. The image is previewed on your profile after saving.</p>
              <div className="profile-photo-actions">
                <button type="button" className="primary" onClick={saveProfilePhoto}>Save photo</button>
                <button type="button" className="secondary" onClick={() => {
                  setProfilePhotoDraft("");
                  setProfilePhotoUrl("");
                  setProfilePhotoLoadError(false);
                  if (user) window.localStorage.removeItem("melo-profile-photo:" + user.uid);
                  setNotice("Custom profile photo removed.");
                }}>Remove</button>
              </div>
              <small className="settings-note">With the current Firestore permissions, this custom URL is saved only on this device. Other members will not see it yet.</small>
            </section>
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
        </div>}      </section>
      <nav className="dock"><div className="dock-inner">
        <span className="dock-indicator" style={{ transform: "translateX(" + tabs.findIndex((item) => item.id === tab) * 100 + "%)" }} />
        {tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} aria-label={item.label}>
          <span className="tab-icon">{item.icon}</span><small>{item.label}</small>
        </button>)}
      </div></nav>
    </>}
  </main>;
}
