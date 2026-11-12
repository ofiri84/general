import { DEFAULT_CATEGORIES, type Me, type Task } from "@yachad/shared";
import { useMemo, useState, type FormEvent } from "react";
import { api, type TaskInput } from "../api";
import { addDays, diffDays, formatDue, todayIso } from "../dates";
import { CheckIcon, CloseIcon, PlusIcon } from "./icons";

type Filter = "all" | "mine" | "partner" | "today";

interface Props {
  me: Me;
  tasks: Task[];
  setTasks: (updater: (prev: Task[]) => Task[]) => void;
  reload: () => Promise<void>;
}

function assigneeName(task: Task, me: Me) {
  if (!task.assignee) return undefined;
  if (task.assignee === "both") return "שנינו";
  if (task.assignee === me.id) return "אני";
  return me.members.find((m) => m.id === task.assignee)?.name ?? "מישהו";
}

function groupOf(task: Task): string {
  if (task.status === "done") return "הושלמו";
  if (!task.dueDate) return "ללא תאריך";
  const diff = diffDays(task.dueDate);
  if (diff < 0) return "באיחור";
  if (diff === 0) return "היום";
  if (diff <= 7) return "בשבוע הקרוב";
  return "אחר כך";
}

const GROUP_ORDER = ["באיחור", "היום", "בשבוע הקרוב", "אחר כך", "ללא תאריך", "הושלמו"];

export function Tasks({ me, tasks, setTasks, reload }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<Task>();
  const [showDone, setShowDone] = useState(false);
  const partner = me.members.find((m) => m.id !== me.id);

  const visible = useMemo(() => {
    const today = todayIso();
    return tasks.filter((t) => {
      if (filter === "mine") return t.assignee === me.id || t.assignee === "both";
      if (filter === "partner") return !!partner && (t.assignee === partner.id || t.assignee === "both");
      if (filter === "today") return t.status === "open" && !!t.dueDate && t.dueDate <= today;
      return true;
    });
  }, [tasks, filter, me.id, partner]);

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of visible) {
      const g = groupOf(t);
      map.set(g, [...(map.get(g) ?? []), t]);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ name: g, tasks: map.get(g)! }));
  }, [visible]);

  const openCount = tasks.filter((t) => t.status === "open").length;

  async function add(e: FormEvent) {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    const optimistic: Task = {
      id: `tmp-${Date.now()}`,
      title: text,
      status: "open",
      createdBy: me.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setTasks((prev) => [optimistic, ...prev]);
    try {
      await api.createTask({ title: text });
    } finally {
      await reload();
    }
  }

  async function toggle(task: Task) {
    const status = task.status === "open" ? "done" : "open";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    try {
      await api.updateTask(task.id, { status });
    } finally {
      await reload();
    }
  }

  async function save(task: Task, patch: TaskInput) {
    setEditing(undefined);
    await api.updateTask(task.id, patch);
    await reload();
  }

  async function remove(task: Task) {
    setEditing(undefined);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    await api.deleteTask(task.id);
    await reload();
  }

  const chips: [Filter, string][] = [
    ["all", "הכל"],
    ["today", "להיום"],
    ["mine", "שלי"],
    ...(partner ? ([["partner", `של ${partner.name}`]] as [Filter, string][]) : []),
  ];

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>שלום {me.name}</h1>
          <p className="muted">{openCount ? `${openCount} משימות פתוחות` : "אין משימות פתוחות. אפשר לנשום."}</p>
        </div>
      </header>

      <form className="quick-add" onSubmit={add}>
        <input placeholder="משימה חדשה..." value={title} onChange={(e) => setTitle(e.target.value)} aria-label="משימה חדשה" />
        <button className="icon-btn primary" aria-label="הוספה" disabled={!title.trim()}>
          <PlusIcon />
        </button>
      </form>

      <div className="chips" role="tablist">
        {chips.map(([key, label]) => (
          <button key={key} className={`chip ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {groups.length === 0 && <p className="empty">אין כאן כלום עדיין. הוסיפו משימה למעלה או בקשו מהעוזר בצ׳אט.</p>}

      {groups.map((group) => {
        const collapsed = group.name === "הושלמו" && !showDone;
        return (
          <div key={group.name} className="group">
            <h2 className={group.name === "באיחור" ? "late" : ""}>
              {group.name} <span className="count">{group.tasks.length}</span>
              {group.name === "הושלמו" && (
                <button className="link" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? "הסתר" : "הצג"}
                </button>
              )}
            </h2>
            {!collapsed && (
              <ul className="task-list">
                {group.tasks.map((task) => (
                  <li key={task.id} className={task.status === "done" ? "done" : ""}>
                    <button
                      className="check"
                      role="checkbox"
                      aria-checked={task.status === "done"}
                      aria-label={task.title}
                      onClick={() => toggle(task)}
                    >
                      {task.status === "done" && <CheckIcon />}
                    </button>
                    <button className="task-body" onClick={() => setEditing(task)}>
                      <span className="task-title">{task.title}</span>
                      <span className="meta">
                        {task.dueDate && (
                          <span className={`tag ${task.status === "open" && diffDays(task.dueDate) < 0 ? "late" : ""}`}>
                            {formatDue(task.dueDate)}
                          </span>
                        )}
                        {assigneeName(task, me) && <span className="tag who">{assigneeName(task, me)}</span>}
                        {task.category && <span className="tag">{task.category}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {editing && <TaskSheet task={editing} me={me} onClose={() => setEditing(undefined)} onSave={save} onDelete={remove} />}
    </section>
  );
}

function TaskSheet({
  task,
  me,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  me: Me;
  onClose: () => void;
  onSave: (task: Task, patch: TaskInput) => void;
  onDelete: (task: Task) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [category, setCategory] = useState(task.category ?? "");
  const today = todayIso();

  const categories = DEFAULT_CATEGORIES.includes(category) || !category ? DEFAULT_CATEGORIES : [category, ...DEFAULT_CATEGORIES];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(task, {
            title: title.trim() || task.title,
            notes: notes.trim() || null,
            dueDate: dueDate || null,
            assignee: assignee || null,
            category: category || null,
          });
        }}
      >
        <div className="sheet-head">
          <h2>עריכת משימה</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה">
            <CloseIcon />
          </button>
        </div>
        <label>
          מה צריך לעשות
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          הערות
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="quick-dates">
          {[
            ["היום", today],
            ["מחר", addDays(today, 1)],
            ["בעוד שבוע", addDays(today, 7)],
          ].map(([label, value]) => (
            <button type="button" key={label} className={`chip ${dueDate === value ? "active" : ""}`} onClick={() => setDueDate(value!)}>
              {label}
            </button>
          ))}
          <button type="button" className="chip" onClick={() => setDueDate("")}>
            בלי תאריך
          </button>
        </div>
        <div className="row">
          <label>
            תאריך
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label>
            של מי
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">לא משויך</option>
              <option value={me.id}>אני</option>
              {me.members
                .filter((m) => m.id !== me.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              <option value="both">שנינו</option>
            </select>
          </label>
        </div>
        <label>
          קטגוריה
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">ללא</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="sheet-actions">
          <button className="primary">שמירה</button>
          <button type="button" className="danger" onClick={() => onDelete(task)}>
            מחיקה
          </button>
        </div>
      </form>
    </div>
  );
}
