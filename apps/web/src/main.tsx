import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function App() {
  return (
    <main>
      <section className="welcome-card" aria-labelledby="page-title">
        <p className="eyebrow">Private games for friends</p>
        <h1 id="page-title">Mahjong Together</h1>
        <p>Simple Chinese house rules for one to four people. Empty seats are filled by bots.</p>
        <button type="button">Create a private room</button>
      </section>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Missing application root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
