import { LAYERS } from '@ind-intg/shared';

// Phase 0 placeholder. The MapLibre map shell arrives in Phase 1.
export function App() {
  return (
    <main className="shell">
      <h1>India Pulse</h1>
      <p>Real-time India-only OSINT map — scaffold.</p>
      <ul>
        {LAYERS.map((l) => (
          <li key={l.id}>
            <span className="swatch" style={{ background: l.colour }} /> {l.name}
          </li>
        ))}
      </ul>
      <footer>Public data, may be delayed or incomplete. Not for navigation or emergency use. Emergencies: 112.</footer>
    </main>
  );
}
