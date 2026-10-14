import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDKqRWK3iSMn5LSo5fh3WjVI30wqQzp7TY",
  authDomain: "attendx-eb082.firebaseapp.com",
  projectId: "attendx-eb082",
  storageBucket: "attendx-eb082.firebasestorage.app",
  messagingSenderId: "531119871019",
  appId: "1:531119871019:web:14bff7c8002a427bf3866e",
  measurementId: "G-JDFSE72NRT"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
