import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, LibraryItem, PostView } from "../shared/types";
import { api } from "./api";
import { shortClip } from "../shared/short";
import { FILTERS, memberMap } from "./format";
import { AvatarStack } from "./components/Bits";
import { DetailSheet } from "./components/DetailSheet";
import { InviteModal, JoinRequestModal, SettingsModal } from "./components/Dialogs";
import { BulkBar, FavouritesModal } from "./components/Favourites";
import { JoinWaiting } from "./components/JoinWaiting";
import { IconChevron, IconGear, IconPlus, IconQueue, IconSearch, IconShare, IconUsers } from "./components/Icons";
import { QueueGrid } from "./components/Mosaic";
import { Onboarding } from "./components/Onboarding";
import { ShareSheet } from "./components/ShareSheet";
import { Viewer } from "./components/Viewer";
import { viewFor } from "./playable";

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
  const notice = state.notice ? (
    <div className="notice-bar" role="status">
      {state.notice}
      <button className="btn small" onClick={() => void api.dismissNotice()}>
        OK
      </button>
    </div>
  ) : null;
  if (state.pendingJoin) {
    return (
      <>
        {notice}
        <JoinWaiting view={state.pendingJoin} />
      </>
    );
  }
  if (!state.identity || !state.group || joinLink) {
    return (
      <>
        {notice}
        <Onboarding key={joinLink ?? "onboard"} state={state} joinLink={joinLink} onDone={() => setJoinLink(null)} />
      </>
    );
  }
  return (
    <>
      {notice}
      <Home state={state} />
    </>
  );
}

function Home({ state }: { state: AppState }) {
  const [filter, setFilter] = useState<string>("all");
  const [person, setPerson] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [sharePaths, setSharePaths] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<"invite" | "settings" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [fav, setFav] = useState<{ found?: { paths: string[]; items: LibraryItem[] } } | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (state.settings.favouritesAsked) return;
    setFav({});
    void api.updateSettings({ favouritesAsked: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const route = useCallback(async (paths: string[]) => {
    const items = await api.scanLibrary(paths).catch(() => [] as LibraryItem[]);
    if (items.length >= 2) setFav({ found: { paths, items } });
    else setSharePaths(paths);
  }, []);

  const members = useMemo(() => memberMap(state.members), [state.members]);
  const friendsOnline = state.members.filter((m) => !m.you && m.online).length;
  const createdHere = !state.group!.joined;

  const flash = useCallback((text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3200);
  }, []);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: state.posts.length };
    for (const f of FILTERS) {
      out[f.id] =
        f.kinds === "clips" ? state.posts.filter((p) => shortClip(p)).length : state.posts.filter((p) => f.kinds.includes(p.meta.kind)).length;
    }
    return out;
  }, [state.posts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds;
    let list = state.posts.filter((p) => {
      if (kinds === "clips") return !!shortClip(p);
      if (kinds && !kinds.includes(p.meta.kind)) return false;
      if (person && members.get(p.author)?.key !== person) return false;
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
  const viewing = viewingId ? state.posts.find((p) => p.id === viewingId && p.localPath) : undefined;

  const openTile = (id: string) => {
    const post = state.posts.find((p) => p.id === id);
    if (post?.localPath && viewFor(post)) {
      setViewingId(id);
      setSelectedId(null);
    } else setSelectedId(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sharePaths && !dialog && !fav) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sharePaths, dialog, fav]);

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
      if (paths.length) void route(paths);
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
  }, [route]);

  useEffect(() => {
    (window as unknown as { queueueShare: (paths: string[]) => void }).queueueShare = (paths) => void route(paths);
  }, [route]);

  async function pickAndShare() {
    const paths = await api.pickSources();
    if (paths.length) await route(paths);
  }

  const group = state.group!;
  const people = state.members.filter((m) => state.posts.some((p) => m.keys.includes(p.author)));

  return (
    <div className="app-frame">
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
                  onClick={() => {
                    setMenuOpen(false);
                    setFav({});
                  }}
                >
                  <IconShare size={13} />
                  Add a folder of favourites
                </button>
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

        <div className="filters" hidden={!!viewing}>
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

        {state.bulk ? <BulkBar bulk={state.bulk} /> : null}

        <div className="main-body">
          {viewing ? (
            <Viewer
              key={`view-${viewing.id}`}
              post={viewing}
              chatOpen={selectedId === viewing.id}
              onToggleChat={() => setSelectedId(selectedId === viewing.id ? null : viewing.id)}
              onClose={() => {
                setViewingId(null);
                setSelectedId(null);
              }}
              onError={(m) => flash(m, true)}
            />
          ) : null}
          <div className="queue-scroll" hidden={!!viewing}>
            {state.posts.length === 0 && state.members.every((m) => m.you) && !createdHere ? (
              <div className="empty">
                <div className="drop-box">
                  <span className="spinner" />
                  <h2>Finding {group.name}…</h2>
                  <p>
                    Your friends' stuff shows up here as soon as one of them has queueue open. Leave this running, it can take a
                    minute the first time.
                  </p>
                </div>
              </div>
            ) : state.posts.length === 0 ? (
              <div className="empty">
                <div className="drop-box">
                  <IconShare size={28} />
                  <h2>Drop something good here</h2>
                  <p>A movie folder, an album, a book, or your whole Movies folder. queueue finds the artwork and makes a tile for each one.</p>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn primary" onClick={() => setFav({})}>
                      Add your favourites
                    </button>
                    <button className="btn" onClick={() => void pickAndShare()}>
                      Share one thing
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
              <QueueGrid posts={visible} members={members} transfers={state.transfers} selectedId={selectedId} autoplay={state.settings.autoplayClips} onOpen={openTile} />
            )}
          </div>
          {selected ? (
            <DetailSheet
              key={`sheet-${selected.id}`}
              post={selected}
              members={members}
              transfer={state.transfers[selected.id]}
              onClose={() => setSelectedId(null)}
              onError={(m) => flash(m, true)}
              onPlay={viewing?.id === selected.id ? undefined : () => setViewingId(selected.id)}
              compact={viewing?.id === selected.id}
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
      {fav ? (
        <FavouritesModal
          key={fav.found ? fav.found.paths.join("|") : "ask"}
          groupName={group.name}
          items={fav.found}
          onClose={() => setFav(null)}
          onShareOne={
            fav.found
              ? (paths) => {
                  setFav(null);
                  setSharePaths(paths);
                }
              : undefined
          }
          onError={(m) => flash(m, true)}
        />
      ) : null}
      {dialog === "invite" ? <InviteModal state={state} onClose={() => setDialog(null)} onError={(m) => flash(m, true)} /> : null}
      <JoinRequestModal state={state} onError={(m) => flash(m, true)} />
      {dialog === "settings" ? <SettingsModal state={state} onClose={() => setDialog(null)} /> : null}
      {toast ? <div className={`toast${toast.error ? " error" : ""}`}>{toast.text}</div> : null}
    </div>
  );
}
