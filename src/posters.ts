export async function generatePoster(src: string, mime: string): Promise<string | null> {
  if (mime.startsWith("image/")) return src;
  if (mime.startsWith("video/")) return captureVideoFrame(src);
  return null;
}

function captureVideoFrame(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = src;

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), 8000);
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      try {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = duration > 0 ? Math.min(1, duration * 0.12) : 0.1;
      } catch {
        finish(null);
      }
    };
    video.onseeked = () => {
      try {
        const w = video.videoWidth || 400;
        const h = video.videoHeight || 600;
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = Math.max(1, Math.round(400 * (h / w)));
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return finish(null);
            finish(URL.createObjectURL(blob));
          },
          "image/jpeg",
          0.82
        );
      } catch {
        finish(null);
      }
    };
  });
}
