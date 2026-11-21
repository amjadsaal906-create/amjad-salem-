import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBVhW... (الكود الكامل)",
  authDomain: "smart-science-ai.firebaseapp.com",
  projectId: "smart-science-ai",
  storageBucket: "smart-science-ai.firebasestorage.app",
  messagingSenderId: "101308347705",
  appId: "1:101308347705:web:2ced5482d061ae1370a4e8",
  measurementId: "G-R76KV1BCYF"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
