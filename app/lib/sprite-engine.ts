export type AnimationAssetType = "static" | "spritesheet" | "css";

export interface AnimationClip {
  startFrame: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  next?: string | null;
}

export interface AnimationAssetDefinition {
  type: AnimationAssetType;
  url?: string | null;
  fallbackUrl?: string | null;
  frameWidth?: number;
  frameHeight?: number;
  columns?: number;
  rows?: number;
  frameCount?: number;
  scale?: number;
  anchor?: { x: number; y: number };
  profile?: string;
  clips?: Record<string, AnimationClip>;
}

export interface AnimationFrame {
  frame: number;
  column: number;
  row: number;
  xPercent: number;
  yPercent: number;
  complete: boolean;
  nextClip: string | null;
}

export function validateAnimationAsset(asset: AnimationAssetDefinition) {
  if (!["static", "spritesheet", "css"].includes(asset.type)) return false;
  if (asset.type === "static") return typeof asset.url === "string" && /^https:\/\//.test(asset.url);
  if (asset.type === "css") return true;
  const columns = Math.floor(asset.columns ?? 0);
  const rows = Math.floor(asset.rows ?? 0);
  const totalFrames = Math.floor(asset.frameCount ?? columns * rows);
  if (!asset.url || !/^https:\/\//.test(asset.url) || columns < 1 || rows < 1 || totalFrames < 1) return false;
  return Object.values(asset.clips ?? {}).every((clip) => (
    Number.isInteger(clip.startFrame) && clip.startFrame >= 0 &&
    Number.isInteger(clip.frameCount) && clip.frameCount > 0 &&
    clip.startFrame + clip.frameCount <= totalFrames &&
    Number.isFinite(clip.fps) && clip.fps > 0 && clip.fps <= 60
  ));
}

export function animationFrameAt(
  asset: AnimationAssetDefinition,
  clipName: string,
  elapsedMs: number,
  reducedMotion = false,
): AnimationFrame {
  const columns = Math.max(1, Math.floor(asset.columns ?? 1));
  const rows = Math.max(1, Math.floor(asset.rows ?? 1));
  const clip = asset.clips?.[clipName] ?? asset.clips?.idle ?? {
    startFrame: 0,
    frameCount: 1,
    fps: 1,
    loop: true,
  };
  const rawOffset = reducedMotion ? 0 : Math.floor(Math.max(0, elapsedMs) / (1_000 / Math.max(1, clip.fps)));
  const complete = !clip.loop && rawOffset >= clip.frameCount;
  const offset = clip.loop ? rawOffset % clip.frameCount : Math.min(clip.frameCount - 1, rawOffset);
  const frame = clip.startFrame + offset;
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  return {
    frame,
    column,
    row,
    xPercent: columns === 1 ? 0 : (column / (columns - 1)) * 100,
    yPercent: rows === 1 ? 0 : (row / (rows - 1)) * 100,
    complete,
    nextClip: complete ? clip.next ?? null : null,
  };
}
