import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import WordHunter from "./app/WordHunter";
import "./styles/app.css";

// Temporary: artifact-style storage on localStorage until the Supabase layer lands.
if (!window.storage) {
  const k = (key, shared) => `${shared ? "shared" : "own"}:${key}`;
  window.storage = {
    async get(key, shared) { const v = localStorage.getItem(k(key, shared)); return v == null ? null : { key, value: v }; },
    async set(key, value, shared) { localStorage.setItem(k(key, shared), value); return { key, value }; },
    async delete(key, shared) { localStorage.removeItem(k(key, shared)); return { key, deleted: true }; },
    async list(prefix, shared) { const p = k(prefix, shared); return { keys: Object.keys(localStorage).filter((x) => x.startsWith(p)).map((x) => x.slice(p.length - prefix.length)) }; },
  };
}

createRoot(document.getElementById("root")).render(<StrictMode><WordHunter /></StrictMode>);
