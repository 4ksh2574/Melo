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
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
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
type Stamp = { toMillis?: () => number; toDate?: () => Date } | null;
type Message = {
  id: string;
  source: string;
  uid: string;
  text: string;
  createdAt?: Stamp;
};
type Conversation = {
  id: string;
  type: "direct" | "group";
  memberIds: string[];
  title?: string;
  createdAt?: Stamp;
  updatedAt?: Stamp;
  isPermanent?: boolean;
  legacy?: boolean;
};
type Gate = "checking" | "signed-out" | "approved" | "pending" | "error";
type Tab = "home" | "explore" | "chats" | "activity" | "profile";
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "explore", label: "People", icon: "⌕" },
  { id: "chats", label: "Chats", icon: "◌" },
  { id: "activity", label: "Activity", icon: "♡" },
  { id: "profile", label: "Profile", icon: "◎" },
];
const chatId = (a: string, b: string) => [a, b].sort().join("__");
const nameOf = (m?: Member) => m?.displayName || m?.username || "Melo member";
const initials = (s: string) => (s.trim()[0] || "M").toUpperCase();
const stampValue = (stamp?: Stamp) => stamp?.toMillis?.() ?? 0;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [gate, setGate] = useState<Gate>("checking");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [legacyChats, setLegacyChats] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<Message[]>([]);
  const [fourMessages, setFourMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [swipeX, setSwipeX] = useState<number | null>(null);
  const [swipeY, setSwipeY] = useState<number | null>(null);
  const [groupPanel, setGroupPanel] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

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
      setConversations(snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      } as Conversation)));
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
    if (!user || !active) {
      setMessages([]);
      setLegacyMessages([]);
      setFourMessages([]);
      return;
    }
    setMessages([]);
    setLegacyMessages([]);
    setFourMessages([]);
    const base = collection(db, "conversations", active.id, "messages");
    const unsubscribeNew = onSnapshot(query(base, orderBy("createdAt", "asc")), (snapshot) => {
      setMessages(snapshot.docs.map((item) => ({
        id: item.id,
        source: "conversation",
        ...item.data(),
      } as Message)));
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
  }, [user, active]);

  const allMembers = useMemo(() => user
    ? [{ uid: user.uid, displayName: user.displayName || user.email || "You" }, ...members]
    : members, [user, members]);

  const filteredMembers = useMemo(() => members.filter((member) =>
    nameOf(member).toLowerCase().includes(search.toLowerCase())
    || (member.username || "").toLowerCase().includes(search.toLowerCase())),
  [members, search]);

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
  ].sort((a, b) => stampValue(a.createdAt) - stampValue(b.createdAt)), [messages, legacyMessages, fourMessages]);

  const titleOf = (conversation: Conversation) => {
    if (conversation.id === "the-four") return "The Four";
    if (conversation.type === "group") return conversation.title || "Private group";
    const otherId = conversation.memberIds.find((id) => id !== user?.uid);
    return nameOf(allMembers.find((member) => member.uid === otherId));
  };

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
      if (conversation.type === "direct") {
        const ref = doc(db, "conversations", conversation.id);
        const snapshot = await getDoc(ref);
        if (!snapshot.exists()) {
          await setDoc(ref, {
            type: "direct",
            memberIds: conversation.memberIds,
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
    setBusy(true);
    try {
      await addDoc(collection(db, "conversations", active.id, "messages"), {
        uid: user.uid,
        text,
        createdAt: serverTimestamp(),
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
  const label = tab === "home" ? "Your circle"
    : tab === "explore" ? "People"
      : tab === "chats" ? "Messages"
        : tab === "activity" ? "Activity" : "Profile";

  return <main className="app" onTouchStart={touchStart} onTouchEnd={touchEnd}>
    <header className="top">
      <div className="brand">melo<span>.</span></div>
      <span className="tagline">closer, even from afar.</span>
      <button className="avatar small" onClick={() => setTab("profile")}>{initials(user?.displayName || "M")}</button>
    </header>
    {notice && <button className="noticebar" onClick={() => setNotice("")}>{notice}<b>×</b></button>}

    {active ? <section className="conversation">
      <header className="conversation-head">
        <button className="back" onClick={() => setActive(null)}>‹</button>
        <div className="avatar">{active.type === "group" ? "✳" : initials(titleOf(active))}</div>
        <div className="conversation-title"><strong>{titleOf(active)}</strong><small>{active.type === "group" ? active.memberIds.length + " members · Private group" : "Private conversation"}</small></div>
      </header>
      <div className="messages">
        {allMessages.length ? allMessages.map((message) => {
          const mine = message.uid === user?.uid;
          const sender = allMembers.find((member) => member.uid === message.uid);
          return <div key={message.source + ":" + message.id} className={"message-wrap " + (mine ? "mine-wrap" : "")}>
            {active.type === "group" && !mine && <small className="message-sender">{nameOf(sender)}</small>}
            <div className={"bubble " + (mine ? "mine" : "")}>{message.text}</div>
          </div>;
        }) : <p className="empty">A little hello goes a long way ✨</p>}
      </div>
      <form className="composer" onSubmit={sendMessage}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" maxLength={4000} />
        <button className="send" disabled={busy || !draft.trim()}>↑</button>
      </form>
    </section> : <>
      <section className="content" key={tab}>
        <div className="heading">
          <div><small>MELO · {label.toUpperCase()}</small><h1>{tab === "home" ? "Good to have you here." : label}</h1></div>
          {tab === "home" && <div className="avatar">{initials(user?.displayName || "M")}</div>}
        </div>

        {tab === "home" && <>
          <div className="welcome"><span className="pulse" /> YOUR PRIVATE FOUR
            <h2>A little closer,<br />every day.</h2>
            <p>Your space for conversations, small updates and everything in between.</p>
          </div>
          <div className="section-title">Your circle <span>{members.length + 1} members</span></div>
          <div className="people-strip">
            <div className="person"><div className="avatar own">{initials(user?.displayName || "M")}</div><small>You</small></div>
            {ordered.map((member) => <button className="person" key={member.uid} onClick={() => openDirect(member)}>
              <div className="avatar">{initials(nameOf(member))}</div><small>{nameOf(member).split(" ")[0]}</small>
            </button>)}
          </div>
          <div className="feature-card"><div><small>STAY CONNECTED</small><h3>Pick up where you left off.</h3>
            <p>Start a private chat or bring a few friends into a group.</p></div>
            <button onClick={() => setTab("chats")}>Open chats ↗</button>
          </div>
        </>}

        {tab === "explore" && <>
          <div className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find someone in your circle" /></div>
          <div className="member-list">{filteredMembers.map((member) => <article className="member" key={member.uid}>
            <div className="avatar">{initials(nameOf(member))}</div>
            <div className="member-info"><strong>{nameOf(member)}</strong><small>@{member.username || "member"}</small></div>
            <button className="outline" onClick={() => openDirect(member)}>Message</button>
          </article>)}
          {!filteredMembers.length && <p className="empty">No other approved members found.</p>}</div>
        </>}

        {tab === "chats" && <>
          <div className="chat-actions"><div><small>YOUR PRIVATE CONVERSATIONS</small><h2>Stay in the loop.</h2></div>
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
          <div className="section-title">Pinned circle</div>
          {fourReady ? <button className="chat-row" onClick={() => openConversation({ id: "the-four", type: "group", title: "The Four", memberIds: [user!.uid, ...members.map((member) => member.uid)] })}>
            <div className="avatar group-avatar">✳</div><div className="member-info"><strong>The Four</strong><small>All four of you · Permanent group</small></div><span className="arrow">›</span>
          </button> : <p className="footnote">The Four will appear when exactly four approved members are available.</p>}
          <div className="section-title">Your conversations <span>{inbox.filter((item) => item.id !== "the-four").length}</span></div>
          <div className="member-list">
            {inbox.filter((item) => item.id !== "the-four").map((conversation) => <button className="chat-row" key={conversation.id} onClick={() => openConversation(conversation)}>
              <div className="avatar">{conversation.type === "group" ? "✳" : initials(titleOf(conversation))}</div>
              <div className="member-info"><strong>{titleOf(conversation)}</strong><small>{conversation.type === "group" ? conversation.memberIds.length + " members · Group" : "Private direct message"}</small></div>
              <span className="arrow">›</span>
            </button>)}
            {!inbox.some((item) => item.id !== "the-four") && <p className="empty">Your private chats and groups will appear here.</p>}
          </div>
          <p className="footnote">Only approved Melo members can open these conversations.</p>
        </>}

        {tab === "activity" && <div className="empty-panel"><div className="empty-icon">♡</div>
          <h3>Your circle's activity</h3><p>Reactions, comments and mentions will appear here as those features are introduced.</p>
        </div>}

        {tab === "profile" && <div className="profile-card">
          <div className="avatar large">{initials(user?.displayName || "M")}</div>
          <h2>{user?.displayName || "Melo member"}</h2><p>{user?.email}</p>
          <span className="member-badge">✓ Approved member</span>
          <button className="secondary" onClick={() => signOut(auth)}>Sign out</button>
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
