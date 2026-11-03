import { useEffect, useState, type FormEvent } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type GateState = "checking" | "signed-out" | "approved" | "pending" | "error";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [gate, setGate] = useState<GateState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setGate("signed-out");
        return;
      }
      setGate("checking");
      try {
        const membership = await getDoc(doc(db, "members", nextUser.uid));
        setGate(membership.exists() && membership.data().active === true ? "approved" : "pending");
      } catch (error) {
        console.error("Melo membership check failed", error);
        setMessage("We couldn't verify your membership. Check your connection and try again.");
        setGate("error");
      }
    });
  }, []);

  async function handleEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      console.error(error);
      setMessage("Sign-in failed. Check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setMessage("");
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (error) {
      console.error(error);
      setMessage("Google sign-in couldn't start. Please try again.");
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
    setMessage("");
  }

  if (gate === "checking") {
    return <main className="screen"><div className="brand">melo<span>.</span></div><div className="loader" /><p className="subtle">Opening your circle…</p></main>;
  }

  if (gate === "signed-out") {
    return (
      <main className="screen">
        <section className="auth-card">
          <div className="brand">melo<span>.</span></div>
          <p className="eyebrow">YOUR PRIVATE CIRCLE</p>
          <h1>Closer, even from afar.</h1>
          <p className="subtle">A quiet little space for the four of you.</p>
          <form onSubmit={handleEmailSignIn}>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            <button className="primary full" disabled={busy}>{busy ? "Please wait…" : "Sign in"}</button>
          </form>
          <button className="google full" onClick={handleGoogleSignIn} disabled={busy}>Continue with Google</button>
          {message && <p className="notice" role="status">{message}</p>}
        </section>
      </main>
    );
  }

  if (gate === "pending" || gate === "error") {
    return (
      <main className="screen">
        <section className="auth-card">
          <div className="brand">melo<span>.</span></div>
          <h1>{gate === "pending" ? "You're not in the circle yet." : "Connection issue"}</h1>
          <p className="subtle">{gate === "pending" ? "This account hasn't been approved for Melo. Ask the circle owner to check your membership." : message}</p>
          <button className="google full" onClick={handleSignOut}>Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <main className="screen">
      <section className="auth-card">
        <div className="brand">melo<span>.</span></div>
        <p className="eyebrow">FOUNDATION MIGRATION</p>
        <h1>You're signed in.</h1>
        <p className="subtle">Authentication and the four-member approval gate are connected to Firebase.</p>
        <div className="account">
          <strong>{user?.displayName || user?.email || "Melo member"}</strong>
          <span>Approved member</span>
        </div>
        <button className="google full" onClick={handleSignOut}>Sign out</button>
      </section>
    </main>
  );
}
