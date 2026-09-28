export type Kind =
  | "movie"
  | "tv"
  | "music"
  | "book"
  | "photos"
  | "video"
  | "audio"
  | "image"
  | "document"
  | "software"
  | "mixed";

export type FileKind = "video" | "audio" | "image" | "document" | "archive" | "subtitle" | "other";

export interface Identity {
  publicKey: string;
  name: string;
  color: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  createdAt: number;
  joined: boolean;
  owner: string;
  isOwner: boolean;
}

export interface Member {
  key: string;
  keys: string[];
  identity: string;
  name: string;
  color: string;
  online: boolean;
  you: boolean;
  owner: boolean;
}

export interface InviteView {
  id: string;
  link: string;
  createdAt: number;
  expires: number;
}

export interface JoinRequest {
  id: string;
  name: string;
  code: string;
  at: number;
}

export interface PendingJoinView {
  name: string;
  from: string;
  status: "finding" | "waiting" | "denied" | "expired" | "used";
  code?: string;
}

export interface FileEntry {
  path: string;
  size: number;
  kind: FileKind;
  mime: string;
  tags?: Record<string, string | number>;
}

export interface Candidate {
  provider: "tmdb" | "tvmaze" | "musicbrainz" | "openlibrary" | "wikipedia" | "local";
  id: string;
  url?: string;
  kind: Kind;
  title: string;
  subtitle?: string;
  year?: number;
  description?: string;
  creators?: string[];
  genres?: string[];
  artworkUrl?: string;
  extra?: Record<string, string | number>;
}

export interface PostMeta {
  kind: Kind;
  title: string;
  subtitle?: string;
  year?: number;
  description?: string;
  creators?: string[];
  genres?: string[];
  artwork?: string;
  artworkAspect?: number;
  source?: { provider: Candidate["provider"]; id: string; url?: string };
  extra?: Record<string, string | number>;
}

export interface Post {
  id: string;
  author: string;
  createdAt: number;
  note?: string;
  meta: PostMeta;
  files: FileEntry[];
  totalSize: number;
  root: string;
  hashes?: string;
}

export interface Comment {
  id: string;
  postId: string;
  author: string;
  createdAt: number;
  text: string;
}

export interface ReactionView {
  emoji: string;
  authors: string[];
}

export interface Transfer {
  postId: string;
  bytes: number;
  total: number;
  state: "queued" | "downloading" | "done" | "error";
  error?: string;
  path?: string;
}

export interface PostView extends Post {
  holders: string[];
  commentCount: number;
  lastActivity: number;
  unread: number;
  reactions: ReactionView[];
  localPath?: string;
}

export interface Settings {
  autoDownload: boolean;
  autoDownloadMaxMB: number;
  downloadDir: string;
  tmdbKey: string;
  openAtLogin: boolean;
}

export interface AppState {
  identity: Identity | null;
  group: GroupInfo | null;
  groups: GroupInfo[];
  members: Member[];
  posts: PostView[];
  transfers: Record<string, Transfer>;
  settings: Settings;
  peers: number;
  ready: boolean;
  invites: InviteView[];
  joinRequests: JoinRequest[];
  pendingJoin: PendingJoinView | null;
  notice: string | null;
}

export interface ShareDraft {
  draftId: string;
  sources: string[];
  files: FileEntry[];
  totalSize: number;
  guess: PostMeta;
  localArtwork?: string;
  candidates: Candidate[];
}

export interface PublishInput {
  draftId: string;
  meta: PostMeta;
  note?: string;
  candidate?: Candidate | null;
}

export interface PublishProgress {
  draftId: string;
  bytes: number;
  total: number;
  done: boolean;
  postId?: string;
  error?: string;
}

export interface QueueueApi {
  getState(): Promise<AppState>;
  onState(cb: (state: AppState) => void): () => void;
  onPublishProgress(cb: (p: PublishProgress) => void): () => void;
  onJoinLink(cb: (link: string) => void): () => void;

  setIdentity(name: string): Promise<Identity>;
  createGroup(name: string): Promise<GroupInfo>;
  joinGroup(invite: string): Promise<void>;
  cancelJoin(): Promise<void>;
  inviteFromClipboard(): Promise<string | null>;
  createInvite(): Promise<InviteView>;
  cancelInvite(id: string): Promise<void>;
  answerJoin(requestId: string, approve: boolean): Promise<void>;
  removeMember(identity: string): Promise<void>;
  dismissNotice(): Promise<void>;
  switchGroup(id: string): Promise<void>;
  leaveGroup(id: string): Promise<void>;

  pickSources(): Promise<string[]>;
  pathForFile(file: File): string;
  prepareShare(paths: string[]): Promise<ShareDraft>;
  searchMetadata(draftId: string, query: string, kind: Kind, year?: number): Promise<Candidate[]>;
  publish(input: PublishInput): Promise<string>;
  deletePost(postId: string): Promise<void>;

  comment(postId: string, text: string): Promise<void>;
  getComments(postId: string): Promise<Comment[]>;
  react(postId: string, emoji: string): Promise<void>;
  markRead(postId: string): Promise<void>;

  download(postId: string): Promise<void>;
  reveal(postId: string): Promise<void>;
  openFile(postId: string, path: string): Promise<void>;

  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  pickDownloadDir(): Promise<string | null>;
  copy(text: string): Promise<void>;
}
