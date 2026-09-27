import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { QueueueApi } from "../shared/types";

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value as T;
}

function listen<T>(channel: string, cb: (v: T) => void) {
  const fn = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => {
    ipcRenderer.removeListener(channel, fn);
  };
}

const api: QueueueApi = {
  getState: () => call("getState"),
  onState: (cb) => listen("state", cb),
  onPublishProgress: (cb) => listen("publish-progress", cb),
  onJoinLink: (cb) => listen("join-link", cb),

  setIdentity: (name) => call("setIdentity", name),
  createGroup: (name) => call("createGroup", name),
  joinGroup: (invite) => call("joinGroup", invite),
  inviteFromClipboard: () => call("inviteFromClipboard"),
  switchGroup: (id) => call("switchGroup", id),
  leaveGroup: (id) => call("leaveGroup", id),

  pickSources: () => call("pickSources"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  prepareShare: (paths) => call("prepareShare", paths),
  searchMetadata: (draftId, query, kind, year) => call("searchMetadata", draftId, query, kind, year),
  publish: (input) => call("publish", input),
  deletePost: (postId) => call("deletePost", postId),

  comment: (postId, text) => call("comment", postId, text),
  getComments: (postId) => call("getComments", postId),
  react: (postId, emoji) => call("react", postId, emoji),
  markRead: (postId) => call("markRead", postId),

  download: (postId) => call("download", postId),
  reveal: (postId) => call("reveal", postId),
  openFile: (postId, path) => call("openFile", postId, path),

  updateSettings: (patch) => call("updateSettings", patch),
  pickDownloadDir: () => call("pickDownloadDir"),
  copy: (text) => call("copy", text),
};

contextBridge.exposeInMainWorld("queueue", api);
