import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAe8NedxzxrKXJEyFaj9k7L4PJGm9qE-4Q",
  authDomain: "melo2574.firebaseapp.com",
  projectId: "melo2574",
  storageBucket: "melo2574.firebasestorage.app",
  messagingSenderId: "601523368007",
  appId: "1:601523368007",
  measurementId: "G-86PLH6VBCZ",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
