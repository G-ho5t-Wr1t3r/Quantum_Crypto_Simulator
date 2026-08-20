import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import Landing from "./screens/landing/Landing";
import Configuration from "./screens/configuration/Configuration";
import Exploration from "./screens/exploration/Exploration";
import Comparison from "./screens/comparison/Comparison";
import Envelope from "./screens/envelope/Envelope";

/**
 * A route change, softened.
 *
 * Keyed on the path, so React tears the old screen down and the new one enters
 * with the animation rather than replacing it in a single frame — which is what
 * made following a link feel like a page load rather than a move.
 *
 * Opacity only, and this is the constraint that shapes it: a `transform` on an
 * ancestor becomes the containing block for every `position: fixed` descendant
 * beneath it. The landing page has two — the nav pill and the scroll progress
 * bar — and they would jump into place the moment the animation ended. Opacity
 * makes a stacking context but not a containing block, so it is safe here where
 * a slide would not be.
 *
 * `prefers-reduced-motion` already collapses this to nothing, from the rule in
 * the token layer.
 */
function Screen({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div
      key={location.pathname}
      style={{ height: "100%", animation: "qfade .32s cubic-bezier(.32,.72,0,1) both" }}
    >
      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Screen>
            <Landing />
          </Screen>
        }
      />
      <Route
        path="/run"
        element={
          <Screen>
            <Configuration />
          </Screen>
        }
      />
      <Route
        path="/explore"
        element={
          <Screen>
            <Exploration />
          </Screen>
        }
      />
      <Route
        path="/compare"
        element={
          <Screen>
            <Comparison />
          </Screen>
        }
      />
      <Route
        path="/envelope"
        element={
          <Screen>
            <Envelope />
          </Screen>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
