import { Channel, initials, Person } from "../lib";
import { IconPlus, IconSeed } from "./Icons";

export function Sidebar({
  workspaceName,
  channels,
  people,
  online,
  activeId,
  seedsActive = false,
  libraryCount = 0,
  me,
  connected,
  unreadCounts = {},
  mentionCounts = {},
  onSelectChannel,
  onSelectDM,
  onOpenSeeds,
  onNewChannel,
  onSettings,
  onSignOut,
  onClose,
}: {
  workspaceName: string;
  channels: Channel[];
  people: Person[];
  online: Person[];
  activeId: string;
  seedsActive?: boolean;
  libraryCount?: number;
  me: Person;
  connected: boolean;
  unreadCounts?: Record<string, number>;
  mentionCounts?: Record<string, number>;
  onSelectChannel: (id: string) => void;
  onSelectDM: (otherPerson: Person) => void;
  onOpenSeeds?: () => void;
  onNewChannel: () => void;
  onSettings: () => void;
  onSignOut: () => void;
  onClose?: () => void;
}) {
  const lounge = channels.filter((c) => c.kind === "lounge");
  const dms = channels.filter(
    (c) =>
      c.kind === "dm" &&
      (c.dmUser1Id === me.id || c.dmUser2Id === me.id)
  );
  const onlineIds = new Set(online.map((p) => p.id));

  // Map other user in DM channel
  function getDmPartner(channel: Channel): Person | undefined {
    const otherId = channel.dmUser1Id === me.id ? channel.dmUser2Id : channel.dmUser1Id;
    return people.find((p) => p.id === otherId);
  }

  return (
    <aside className="sidebar mac-window">
      <div className="workspace-header mac-titlebar">
        <button
          className="mac-close-box"
          onClick={onClose || onSettings}
          title={onClose ? "Close" : "Settings"}
          type="button"
          aria-label={onClose ? "Close sidebar" : "Settings"}
        />
        <h2 className="workspace-title">{workspaceName}</h2>
        <button className="mac-titlebar-btn" onClick={onSettings} title="Settings" type="button">
          ···
        </button>
      </div>

      <div className="sidebar-section">
        <button
          type="button"
          className={`channel-btn ${seedsActive ? "active" : ""}`}
          onClick={onOpenSeeds}
        >
          <span className="channel-hash ui-icon"><IconSeed size={14} /></span>
          <span className="channel-name">Seeds</span>
          {libraryCount > 0 ? (
            <span className="seeds-count" title={`${libraryCount} in the library`}>
              {libraryCount}
            </span>
          ) : null}
        </button>
        <div className="section-label">
          <span>Channels</span>
          <button className="icon-btn" type="button" onClick={onNewChannel} title="Create channel">
            <IconPlus size={12} />
          </button>
        </div>
        {lounge.map((channel) => {
          const unread = unreadCounts[channel.id] || 0;
          const mentions = mentionCounts[channel.id] || 0;
          return (
            <button
              key={channel.id}
              type="button"
              className={`channel-btn ${channel.id === activeId ? "active" : ""} ${unread > 0 || mentions > 0 ? "has-unread" : ""}`}
              onClick={() => onSelectChannel(channel.id)}
            >
              <span className="channel-hash">#</span>
              <span className="channel-name">{channel.name}</span>
              {mentions > 0 ? (
                <span className="unread-badge mention-badge" title={`You were mentioned in #${channel.name}`}>
                  @{mentions}
                </span>
              ) : unread > 0 ? (
                <span className="unread-badge" title={`${unread} unread message${unread === 1 ? "" : "s"}`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </button>
          );
        })}

        <div className="section-label" style={{ marginTop: 18 }}>
          <span>Direct Messages</span>
        </div>
        {people
          .filter((p) => p.id !== "u_natter" && p.id !== me.id)
          .map((person) => {
            const partnerDm = dms.find(
              (d) =>
                (d.dmUser1Id === me.id && d.dmUser2Id === person.id) ||
                (d.dmUser2Id === me.id && d.dmUser1Id === person.id)
            );
            const isDmActive = partnerDm && partnerDm.id === activeId;
            const dmUnread = partnerDm ? (unreadCounts[partnerDm.id] || 0) : 0;
            const dmMentions = partnerDm ? (mentionCounts[partnerDm.id] || 0) : 0;

            return (
              <button
                key={person.id}
                type="button"
                className={`channel-btn ${isDmActive ? "active" : ""} ${dmUnread > 0 || dmMentions > 0 ? "has-unread" : ""}`}
                onClick={() => onSelectDM(person)}
                title={`Direct message ${person.displayName}`}
              >
                <div
                  className="avatar sm"
                  style={{
                    background: person.color,
                    width: 20,
                    height: 20,
                    fontSize: 10,
                  }}
                >
                  {initials(person.displayName)}
                  {onlineIds.has(person.id) && (
                    <span
                      className="presence-dot"
                      style={{ width: 8, height: 8, right: -1, bottom: -1 }}
                    />
                  )}
                </div>
                <span className="channel-name">{person.displayName}</span>
                {dmMentions > 0 ? (
                  <span className="unread-badge mention-badge" title={`You were mentioned`}>
                    @{dmMentions}
                  </span>
                ) : dmUnread > 0 ? (
                  <span className="unread-badge" title={`${dmUnread} unread message${dmUnread === 1 ? "" : "s"}`}>
                    {dmUnread > 99 ? "99+" : dmUnread}
                  </span>
                ) : null}
              </button>
            );
          })}
      </div>

      <div className="sidebar-footer">
        <div className="avatar" style={{ background: me.color }}>
          {initials(me.displayName)}
          {connected && <span className="presence-dot" />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: "white", fontWeight: 700 }} className="channel-name">
            {me.displayName}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {connected ? "Active" : "Reconnecting…"}
          </div>
        </div>
        <button
          className="logout-btn"
          type="button"
          onClick={onSignOut}
          title="Sign out of your account"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
