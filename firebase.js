// firebase.js — Firestore + Storage init for the Compliance & Risk Tracker
// Loaded as an ES module from index.html: <script type="module" src="firebase.js"></script>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ====== PASTE YOUR WEB APP CONFIG BELOW ======
// In Firebase Console → Project settings → Your apps → "Compliance & Risk Tracker"
// → SDK setup → choose "Config" → copy the firebaseConfig object → paste it here.
const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "stock-manager-5dc93.firebaseapp.com",
  projectId: "stock-manager-5dc93",
  storageBucket: "stock-manager-5dc93.appspot.com",
  messagingSenderId: "388830950028",
  appId: "1:388830950028:web:747bccda1eff96da33c1a9"
};
// =============================================

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Re-export the helpers app.js needs so it can import everything from one place.
export {
  collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch,
  ref, uploadBytes, getDownloadURL, deleteObject
};
