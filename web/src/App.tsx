import { Navigate, Route, Routes } from "react-router-dom";

import Landing from "./screens/landing/Landing";
import Configuration from "./screens/configuration/Configuration";
import Exploration from "./screens/exploration/Exploration";
import Comparison from "./screens/comparison/Comparison";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/run" element={<Configuration />} />
      <Route path="/explore" element={<Exploration />} />
      <Route path="/compare" element={<Comparison />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
