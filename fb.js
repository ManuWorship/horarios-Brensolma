// Inicialización de Firebase compartida por la app y el panel.
import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where,
  getDocs, onSnapshot, serverTimestamp, orderBy, Timestamp,
} from "firebase/firestore";

const app = initializeApp(window.FIREBASE_CONFIG);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
export const db = getFirestore(app);
export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where,
  getDocs, onSnapshot, serverTimestamp, orderBy, Timestamp,
};
