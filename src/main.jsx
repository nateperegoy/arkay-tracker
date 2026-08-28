import React from "react";
import ReactDOM from "react-dom/client";
import { storageAdapter } from "./lib/storageAdapter";
import App from "./App.jsx";
import "./index.css";

// The entire app was written against Claude's built-in window.storage API.
// Setting it here, before the app renders, means none of that code needs to
// change — it keeps calling window.storage.get/set/delete exactly as before,
// and this adapter quietly handles the real Supabase reads and writes underneath.
window.storage = storageAdapter;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
