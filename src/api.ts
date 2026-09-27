import type { QueueueApi } from "../shared/types";

declare global {
  interface Window {
    queueue: QueueueApi;
  }
}

export const api = window.queueue;
