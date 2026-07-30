// firebase.js — Firestore + Storage + Auth init for the Compliance & Risk Tracker
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, deleteDoc,
  onSnapshot, writeBatch, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAF5Vlfkrv9Hk5M-Z2mO2t-YDSM88sQyo8",
  authDomain: "compliance-risk-tracker-40631.firebaseapp.com",
  projectId: "compliance-risk-tracker-40631",
  storageBucket: "compliance-risk-tracker-40631.firebasestorage.app",
  messagingSenderId: "33876014262",
  appId: "1:33876014262:web:4e642bf8ef1b3f4235e217",
  measurementId: "G-MZ9WD7ZYGS"
};

// Admin emails — full delete & user-management rights
export const ADMIN_EMAILS = ["mostafa.hegab83@gmail.com"];

// Dashboard-only (view-only) users.
// These accounts can ONLY see:
//   Dashboard  -> Findings Dashboard + Risk Dashboard
//   Gap Analysis -> Gap Assessment Dashboard + Process Validation Dashboard
// Add the emails of limited-access users here (lowercase).
export const VIEWER_EMAILS = [sherien.gergis@almokhtabar.com
  // "viewer1@example.com",
];

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

export {
  collection, doc, setDoc, getDoc, addDoc, deleteDoc,
  onSnapshot, writeBatch, serverTimestamp, query, orderBy, limit,
  ref, uploadBytes, getDownloadURL, deleteObject,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail
};