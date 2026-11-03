import { useEffect, useMemo, useState, type FormEvent, type TouchEvent } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signInWithRedirect, signOut, type User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type Member = { uid:string; displayName?:string; username?:string; active?:boolean; photoURL?:string };
type Message = { id:string; uid:string; text:string; createdAt?:{toDate?:()=>Date} };
type Gate = "checking"|"signed-out"|"approved"|"pending"|"error";
type Tab = "home"|"explore"|"chats"|"activity"|"profile";
const tabs: {id:Tab;label:string;icon:string}[] = [
 {id:"home",label:"Home",icon:"⌂"},{id:"explore",label:"Explore",icon:"⌕"},{id:"chats",label:"Chats",icon:"◌"},{id:"activity",label:"Activity",icon:"♡"},{id:"profile",label:"Profile",icon:"◎"}
];
const chatId=(a:string,b:string)=>[a,b].sort().join("__");
const nameOf=(m:Member)=>m.displayName||m.username||"Melo member";
const initials=(s:string)=>(s.trim()[0]||"M").toUpperCase();

export default function App(){
 const [user,setUser]=useState<User|null>(null),[gate,setGate]=useState<Gate>("checking"),[notice,setNotice]=useState("");
 const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false);
 const [tab,setTab]=useState<Tab>("home"),[members,setMembers]=useState<Member[]>([]),[following,setFollowing]=useState<string[]>([]);
 const [active,setActive]=useState<Member|null>(null),[messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState("");
 const [search,setSearch]=useState(""),[swipeX,setSwipeX]=useState<number|null>(null),[swipeY,setSwipeY]=useState<number|null>(null);

 useEffect(()=>onAuthStateChanged(auth,async u=>{
  setUser(u); if(!u){setGate("signed-out");return;} setGate("checking");
  try{const m=await getDoc(doc(db,"members",u.uid));setGate(m.exists()&&m.data().active===true?"approved":"pending");}
  catch(e){console.error(e);setNotice("We couldn't verify your membership. Check your connection.");setGate("error");}
 }),[]);

 useEffect(()=>{
  if(gate!=="approved"||!user)return;
  const unsubMembers=onSnapshot(query(collection(db,"members"),where("active","==",true)),s=>setMembers(s.docs.map(d=>({uid:d.id,...d.data()} as Member)).filter(m=>m.uid!==user.uid)),e=>{console.error(e);setNotice("Couldn't load your circle.");});
  const unsubFollows=onSnapshot(query(collection(db,"follows"),where("followerUid","==",user.uid)),s=>setFollowing(s.docs.map(d=>String(d.data().followedUid))),e=>console.error(e));
  return ()=>{unsubMembers();unsubFollows();};
 },[gate,user]);

 useEffect(()=>{
  if(!user||!active){setMessages([]);return;}
  const id=chatId(user.uid,active.uid),ref=doc(db,"chats",id);
  let alive=true;
  getDoc(ref).then(s=>{if(alive&&!s.exists())return setDoc(ref,{memberIds:[user.uid,active.uid].sort(),createdAt:serverTimestamp()});}).catch(e=>{console.error(e);setNotice("Couldn't open this conversation. Check membership and chat permissions.");});
  const unsub=onSnapshot(query(collection(db,"chats",id,"messages"),orderBy("createdAt","asc")),s=>setMessages(s.docs.map(d=>({id:d.id,...d.data()} as Message))),e=>{console.error(e);setNotice("Messages couldn't be loaded. Firestore rules may need updating.");});
  return ()=>{alive=false;unsub();};
 },[user,active]);

 const filtered=useMemo(()=>members.filter(m=>nameOf(m).toLowerCase().includes(search.toLowerCase())||(m.username||"").toLowerCase().includes(search.toLowerCase())),[members,search]);
 const startChat=(m:Member)=>{if(!user)return;if(!following.includes(m.uid)){setNotice("This account's current Firestore rules require a follow before opening a direct chat. We'll remove that restriction in the conversation-rules migration.");setTab("explore");return;}setActive(m);};
 async function send(e:FormEvent){e.preventDefault();const text=draft.trim();if(!text||!user||!active)return;setBusy(true);try{await addDoc(collection(db,"chats",chatId(user.uid,active.uid),"messages"),{uid:user.uid,text,createdAt:serverTimestamp()});setDraft("");}catch(err){console.error(err);setNotice("Message not sent. Check your connection and Firestore rules.");}finally{setBusy(false);}}
 async function follow(m:Member){if(!user)return;const id=user.uid+"_"+m.uid;try{await setDoc(doc(db,"follows",id),{followerUid:user.uid,followedUid:m.uid,createdAt:serverTimestamp()});}catch(e){console.error(e);setNotice("Couldn't follow this member.");}}
 async function login(e:FormEvent){e.preventDefault();setBusy(true);setNotice("");try{await signInWithEmailAndPassword(auth,email.trim(),password);}catch(err){console.error(err);setNotice("Sign-in failed. Check your details.");}finally{setBusy(false);}}
 async function google(){setBusy(true);try{await signInWithRedirect(auth,googleProvider);}catch(e){console.error(e);setNotice("Google sign-in couldn't start.");setBusy(false);}}

 if(gate==="checking")return <main className="center"><div className="brand">melo<span>.</span></div><div className="loader"/><p>Opening your circle…</p></main>;
 if(gate==="signed-out")return <main className="center"><section className="auth"><div className="brand">melo<span>.</span></div><small>YOUR PRIVATE CIRCLE</small><h1>Closer, even from afar.</h1><p>A quiet little space for the four of you.</p><form onSubmit={login}><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="primary" disabled={busy}>Sign in</button></form><button className="secondary" onClick={google} disabled={busy}>Continue with Google</button>{notice&&<p className="notice">{notice}</p>}</section></main>;
 if(gate==="pending"||gate==="error")return <main className="center"><section className="auth"><div className="brand">melo<span>.</span></div><h1>{gate==="pending"?"You're not in the circle yet.":"Connection issue"}</h1><p>{gate==="pending"?"This account hasn't been approved for Melo.":notice}</p><button className="secondary" onClick={()=>signOut(auth)}>Sign out</button></section></main>;

 const ordered=members.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
 const touchStart=(e:TouchEvent)=>{if(active)return;setSwipeX(e.touches[0].clientX);setSwipeY(e.touches[0].clientY);};
 const touchEnd=(e:TouchEvent)=>{if(swipeX===null||swipeY===null||active)return;const dx=e.changedTouches[0].clientX-swipeX,dy=e.changedTouches[0].clientY-swipeY;setSwipeX(null);setSwipeY(null);if(Math.abs(dx)>85&&Math.abs(dx)>Math.abs(dy)*1.4){const i=tabs.findIndex(t=>t.id===tab),n=Math.max(0,Math.min(tabs.length-1,i+(dx<0?1:-1)));setTab(tabs[n].id);}};
 const label=tab==="home"?"Your circle":tab==="explore"?"People":tab==="chats"?"Messages":tab==="activity"?"Activity":"Profile";
 return <main className="app" onTouchStart={touchStart} onTouchEnd={touchEnd}>
  <header className="top"><div className="brand">melo<span>.</span></div><span className="tagline">closer, even from afar.</span><button className="avatar small" onClick={()=>setTab("profile")}>{initials(user?.displayName||"M")}</button></header>
  {notice&&<button className="noticebar" onClick={()=>setNotice("")}>{notice} <b>×</b></button>}
  {active?<section className="conversation"><header className="conversation-head"><button className="back" onClick={()=>setActive(null)}>‹</button><div className="avatar">{initials(nameOf(active))}</div><div><strong>{nameOf(active)}</strong><small>Private conversation</small></div></header><div className="messages">{messages.length?messages.map(m=><div key={m.id} className={"bubble "+(m.uid===user?.uid?"mine":"")}>{m.text}</div>):<p className="empty">Say hello ✨</p>}</div><form className="composer" onSubmit={send}><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Write a message…" maxLength={4000}/><button className="send" disabled={busy||!draft.trim()}>↑</button></form></section>:
  <><section className="content" key={tab}>
   <div className="heading"><div><small>MELO · {label.toUpperCase()}</small><h1>{tab==="home"?"Good to have you here.":label}</h1></div>{tab==="home"&&<div className="avatar">{initials(user?.displayName||"M")}</div>}</div>
   {tab==="home"&&<><div className="welcome"><span className="pulse"/> YOUR PRIVATE FOUR <h2>A little closer,<br/>every day.</h2><p>Your space for conversations, small updates and everything in between.</p></div><div className="section-title">Your circle <span>{members.length+1} members</span></div><div className="people-strip"><div className="person"><div className="avatar own">{initials(user?.displayName||"M")}</div><small>You</small></div>{ordered.map(m=><button className="person" key={m.uid} onClick={()=>startChat(m)}><div className="avatar">{initials(nameOf(m))}</div><small>{nameOf(m).split(" ")[0]}</small></button>)}</div><div className="feature-card"><div><small>STAY CONNECTED</small><h3>Pick up where you left off.</h3><p>Open a conversation with someone in your circle.</p></div><button onClick={()=>setTab("chats")}>Open chats ↗</button></div></>}
   {tab==="explore"&&<><div className="search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find someone in your circle"/></div><div className="member-list">{filtered.map(m=><article className="member" key={m.uid}><div className="avatar">{initials(nameOf(m))}</div><div className="member-info"><strong>{nameOf(m)}</strong><small>@{m.username||"member"}</small></div>{following.includes(m.uid)?<button className="outline" onClick={()=>startChat(m)}>Message</button>:<button className="outline" onClick={()=>follow(m)}>Connect</button>}</article>)}</div></>}
   {tab==="chats"&&<><div className="search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your circle"/></div><div className="section-title">People you can message</div><div className="member-list">{ordered.filter(m=>following.includes(m.uid)).map(m=><button className="chat-row" key={m.uid} onClick={()=>startChat(m)}><div className="avatar">{initials(nameOf(m))}</div><div className="member-info"><strong>{nameOf(m)}</strong><small>Open private conversation</small></div><span className="arrow">›</span></button>)}{!ordered.some(m=>following.includes(m.uid))&&<p className="empty">Your chats will appear here once you connect with another member.</p>}</div><p className="footnote">Direct messages are private to their two approved members.</p></>}
   {tab==="activity"&&<div className="empty-panel"><div className="empty-icon">♡</div><h3>Your circle's activity</h3><p>Reactions, comments and mentions will appear here as those features are introduced.</p></div>}
   {tab==="profile"&&<div className="profile-card"><div className="avatar large">{initials(user?.displayName||"M")}</div><h2>{user?.displayName||"Melo member"}</h2><p>{user?.email}</p><span className="member-badge">✓ Approved member</span><button className="secondary" onClick={()=>signOut(auth)}>Sign out</button></div>}
  </section><nav className="dock"><div className="dock-inner"><span className="dock-indicator" style={{transform:"translateX("+tabs.findIndex(t=>t.id===tab)*100+"%)"}}/>{tabs.map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>setTab(t.id)} aria-label={t.label}><span className="tab-icon">{t.icon}</span><small>{t.label}</small></button>)}</div></nav></>}
 </main>;
}
