import type { Me, Task } from "@yachad/shared";
import { useCallback, useEffect, useState } from "react";
import { UnauthorizedError, api } from "./api";
import { isSignedIn } from "./auth";
import { Chat } from "./components/Chat";
import { Login } from "./components/Login";
import { Settings } from "./components/Settings";
import { Tasks } from "./components/Tasks";
import { ChatIcon, PlugIcon, TasksIcon } from "./components/icons";

type Tab = "tasks" | "chat" | "settings";

const googleNotices: Record<string, string> = {
  connected: "✓ Google Drive חובר בהצלחה",
  denied: "החיבור בוטל",
  error: "החיבור נכשל, נסו שוב",
};

export function App() {
  const [auth, setAuth] = useState<"loading" | "out" | "in">("loading");
  const [me, setMe] = useState<Me>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<Tab>("tasks");
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const g = params.get("google");
    if (g) {
      setNotice(googleNotices[g]);
      setTab("settings");
      history.replaceState(null, "", location.pathname);
    }
    isSignedIn().then((ok) => setAuth(ok ? "in" : "out"));
  }, []);

  const reload = useCallback(async () => {
    try {
      setTasks(await api.tasks());
    } catch (e) {
      if (e instanceof UnauthorizedError) setAuth("out");
    }
  }, []);

  useEffect(() => {
    if (auth !== "in") return;
    api.me().then(setMe).catch((e) => e instanceof UnauthorizedError && setAuth("out"));
    void reload();
    const timer = setInterval(reload, 30_000);
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth, reload]);

  if (auth === "loading") return <div className="splash" />;
  if (auth === "out") return <Login onDone={() => setAuth("in")} />;
  if (!me) return <div className="splash" />;

  return (
    <div className="app">
      <main>
        {tab === "tasks" && <Tasks me={me} tasks={tasks} setTasks={(fn) => setTasks(fn)} reload={reload} />}
        {tab === "chat" && <Chat onTasksChanged={reload} />}
        {tab === "settings" && <Settings me={me} notice={notice} onLogout={() => setAuth("out")} />}
      </main>
      <nav className="tabbar">
        {(
          [
            ["tasks", "משימות", <TasksIcon key="t" />],
            ["chat", "עוזר", <ChatIcon key="c" />],
            ["settings", "חיבורים", <PlugIcon key="s" />],
          ] as [Tab, string, JSX.Element][]
        ).map(([key, label, icon]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)} aria-current={tab === key}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
