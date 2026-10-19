// Canvas sizes and lengths of the square compositions. Kept outside the "use client"
// composition files: a server page that imports a constant from a client module gets a
// reference, not the number, and the animation would never know when to loop.
export const UNDERSTAND = { width: 1080, height: 1080, fps: 30, frames: 330 } as const;
export const OFFER = { width: 1080, height: 1080, fps: 30, frames: 300 } as const;
export const TREND = { frames: 330 } as const;
export const JOURNEY = { frames: 270 } as const;
export const TREND_MAP = { frames: 165 } as const;
export const TREND_CURVE = { frames: 180 } as const;
