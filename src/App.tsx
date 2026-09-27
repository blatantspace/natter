import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, PostView } from "../shared/types";
import { api } from "./api";
import { FILTERS, memberMap } from "./format";
import { AvatarStack } from "./components/Bits";
import { DetailSheet } from "./components/DetailSheet";
import { InviteModal, SettingsModal } from "./components/Dialogs";
import { IconChevron, IconGear, IconPlus, IconQueue, IconSearch, IconShare, IconUsers } from "./components/Icons";
import { Mosaic } from "./components/Mosaic";
import { Onboarding } from "./components/Onboarding";
import { ShareSheet } from "./components/ShareSheet";

type Sort = "new" | "talk" | "unread";

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [joinLink, setJoinLink] = useState<string | null>(null);

  useEffect(() => {
    void api.getState().then(setState);
    const offState = api.onState(setState);
    const offLink = api.onJoinLink(setJoinLink);
    return () => {
      offState();
      offLink();
    };
  }, []);

  if (!state) return null;
  if (!state.identity || !state.group || joinLink) {
    return <Onboarding key={joinLink ?? "onboard"} state={state} joinLink={joinLink} onDone={() => setJoinLink(null)} />;
  }
  return <Home state={state} />;
}

function Home({ state }: { state: AppState }) {
  const [filter, setFilter] = useState<string>("all");
  const [person, setPerson] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sharePaths, setSharePaths] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<"invite" | "settings" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const dragDepth = useRef(0);

  const members = useMemo(() => memberMap(state.members), [state.members]);
  const friendsOnline = state.members.filter((m) => !m.you && m.online).length;

  const flash = useCallback((text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3200);
  }, []);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: state.posts.length };
    for (const f of FILTERS) out[f.id] = state.posts.filter((p) => f.kinds.includes(p.meta.kind)).length;
    return out;
  }, [state.posts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds;
    let list = state.posts.filter((p) => {
      if (kinds && !kinds.includes(p.meta.kind)) return false;
      if (person && p.author !== person) return false;
      if (!q) return true;
      const hay = [p.meta.title, p.meta.subtitle, p.meta.description, p.note, ...(p.meta.genres ?? []), ...(p.meta.creators ?? []), members.get(p.author)?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    const by: Record<Sort, (a: PostView, b: PostView) => number> = {
      new: (a, b) => b.createdAt - a.createdAt,
      talk: (a, b) => b.commentCount - a.commentCount || b.lastActivity - a.lastActivity,
      unread: (a, b) => b.unread - a.unread || b.lastActivity - a.lastActivity,
    };
    list = [...list].sort(by[sort]);
    return list;
  }, [state.posts, filter, person, query, sort, members]);

  const selected = selectedId ? state.posts.find((p) => p.id === selectedId) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sharePaths && !dialog) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sharePaths, dialog]);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => api.pathForFile(f)).filter(Boolean);
      if (paths.length) setSharePaths(paths);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  useEffect(() => {
    (window as unknown as { queueueShare: (paths: string[]) => void }).queueueShare = setSharePaths;
  }, []);

  async function pickAndShare() {
    const paths = await api.pickSources();
    if (paths.length) setSharePaths(paths);
  }

  const group = state.group!;
  const people = state.members.filter((m) => state.posts.some((p) => p.author === m.key));

  return (
    <div className="app-frame">
      <div className="drag-strip">queueue</div>
      <div className="mac-window">
        <div className="mac-titlebar">
          <span />
          <span className="title">{group.name}</span>
          <span className="title-right">
            <span className="peer-pill" title={`${state.peers} connection${state.peers === 1 ? "" : "s"}`}>
              <span className={`dot${friendsOnline ? " on" : ""}`} />
              {friendsOnline ? `${friendsOnline} friend${friendsOnline === 1 ? "" : "s"} online` : "Looking for friends…"}
            </span>
          </span>
        </div>

        <div className="toolbar">
          <div style={{ position: "relative" }}>
            <button className="group-switch" onClick={() => setMenuOpen((v) => !v)}>
              <span className="group-glyph">
                <IconQueue size={16} />
              </span>
              {group.name}
              <IconChevron size={12} />
            </button>
            {menuOpen ? (
              <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
                {state.groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setMenuOpen(false);
                      if (g.id !== group.id) void api.switchGroup(g.id);
                    }}
                  >
                    <IconQueue size={13} />
                    {g.name}
                    {g.id === group.id ? <span style={{ marginLeft: "auto" }}>✓</span> : null}
                  </button>
                ))}
                <hr />
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    const name = prompt("Name your new queueue");
                    if (name !== null) await api.createGroup(name).catch((e: Error) => flash(e.message, true));
                  }}
                >
                  <IconPlus size={13} />
                  Start another queueue
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    const link = prompt("Paste an invite link");
                    if (link) await api.joinGroup(link).catch((e: Error) => flash(e.message, true));
                  }}
                >
                  <IconUsers size={13} />
                  Join with a link
                </button>
                <hr />
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    if (confirm(`Leave ${group.name}? Your downloads stay on your Mac.`)) await api.leaveGroup(group.id);
                  }}
                >
                  Leave {group.name}
                </button>
              </div>
            ) : null}
          </div>

          <button className="btn" style={{ gap: 8 }} onClick={() => setDialog("invite")} title="Who's here">
            <AvatarStack members={state.members} max={5} size={20} showOnline />
            Invite
          </button>

          <div className="search">
            <IconSearch size={14} />
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, people, genres" />
          </div>

          <button className="btn icon" onClick={() => setDialog("settings")} aria-label="Settings" title="Settings">
            <IconGear size={16} />
          </button>
          <button className="btn primary" onClick={() => void pickAndShare()}>
            <IconShare size={14} />
            Share
          </button>
        </div>

        <div className="filters">
          <button className={`chip${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
            Everything <span className="count">{counts.all}</span>
          </button>
          {FILTERS.filter((f) => counts[f.id] > 0 || filter === f.id).map((f) => (
            <button key={f.id} className={`chip${filter === f.id ? " active" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label} <span className="count">{counts[f.id]}</span>
            </button>
          ))}
          {people.length > 1 ? <span className="chip-sep" /> : null}
          {people.length > 1
            ? people.map((m) => (
                <button key={m.key} className={`chip${person === m.key ? " active" : ""}`} onClick={() => setPerson(person === m.key ? null : m.key)}>
                  <span className="avatar" style={{ background: m.color, ["--size" as string]: "16px", borderWidth: 1 }}>
                    {m.name.slice(0, 1)}
                  </span>
                  {m.you ? "You" : m.name}
                </button>
              ))
            : null}
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="new">Newest</option>
            <option value="talk">Most talked about</option>
            <option value="unread">Unread first</option>
          </select>
        </div>

        <div className="main-body">
          <div className="mosaic-scroll">
            {state.posts.length === 0 ? (
              <div className="empty">
                <div className="drop-box">
                  <IconShare size={28} />
                  <h2>Drop something good here</h2>
                  <p>A movie folder, an album, a book, last weekend's photos. queueue finds the artwork and details for everyone.</p>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn primary" onClick={() => void pickAndShare()}>
                      Choose files or folders
                    </button>
                    <button className="btn" onClick={() => setDialog("invite")}>
                      Invite friends
                    </button>
                  </div>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="empty">
                <p>Nothing matches that. Try another filter.</p>
              </div>
            ) : (
              <Mosaic posts={visible} members={members} transfers={state.transfers} selectedId={selectedId} onOpen={setSelectedId} />
            )}
          </div>
          {selected ? (
            <DetailSheet
              key={selected.id}
              post={selected}
              members={members}
              transfer={state.transfers[selected.id]}
              onClose={() => setSelectedId(null)}
              onError={(m) => flash(m, true)}
            />
          ) : null}
        </div>
      </div>

      {dragging ? (
        <div className="drop-overlay">
          <div className="card">
            <IconShare size={28} />
            Drop to share with {group.name}
            <span>Files and whole folders both work</span>
          </div>
        </div>
      ) : null}

      {sharePaths ? (
        <ShareSheet
          paths={sharePaths}
          groupName={group.name}
          onClose={() => setSharePaths(null)}
          onPublished={(id) => {
            setSharePaths(null);
            setSelectedId(id);
            flash("Shared. Friends will see it as soon as they're online.");
          }}
        />
      ) : null}
      {dialog === "invite" ? <InviteModal state={state} onClose={() => setDialog(null)} /> : null}
      {dialog === "settings" ? <SettingsModal state={state} onClose={() => setDialog(null)} /> : null}
      {toast ? <div className={`toast${toast.error ? " error" : ""}`}>{toast.text}</div> : null}
    </div>
  );
}
