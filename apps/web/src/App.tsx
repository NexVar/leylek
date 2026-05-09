// TODO: replace with real dashboard once DESIGN.md is approved.
import { Route, Routes } from 'react-router-dom';

function Placeholder() {
  return (
    <div className="min-h-screen flex items-center justify-center text-lg">
      Leylek — scaffold ready
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder />} />
    </Routes>
  );
}
