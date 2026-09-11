import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { socket } from "./lib/socket";
import Landing from "./pages/Landing";
import JoinStudent from "./pages/JoinStudent";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <>
      <ConnectionBar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/join/:code" element={<JoinStudent />} />
        <Route path="/room/:code" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

/** Campus wifi drops. Say so plainly rather than letting the screen quietly go stale. */
function ConnectionBar() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    socket.on("disconnect", down);
    socket.on("connect", up);
    return () => {
      socket.off("disconnect", down);
      socket.off("connect", up);
    };
  }, []);

  if (!offline) return null;
  return (
    <div role="status" className="sticky top-0 z-40 bg-busy text-paper text-center py-2 font-semibold">
      Reconnecting…
    </div>
  );
}
