// firebase.js — Firestore + Storage init for the Compliance & Risk Tracker
// Loaded as an ES module from index.html: <script type="module" src="firebase.js"></script>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Firebase project: compliance-risk-tracker-40631
const firebaseConfig = {
  apiKey: "AIzaSyAF5Vlfkrv9Hk5M-Z2mO2t-YDSM88sQyo8",
  authDomain: "compliance-risk-tracker-40631.firebaseapp.com",
  projectId: "compliance-risk-tracker-40631",
  storageBucket: "compliance-risk-tracker-40631.firebasestorage.app",
  messagingSenderId: "33876014262",
  appId: "1:33876014262:web:4e642bf8ef1b3f4235e217",
  measurementId: "G-MZ9WD7ZYGS"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Re-export the helpers app.js needs so it can import everything from one place.
export {
  collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch,
  ref, uploadBytes, getDownloadURL, deleteObject
};
