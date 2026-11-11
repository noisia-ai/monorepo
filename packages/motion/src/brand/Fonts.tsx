import { continueRender, delayRender, staticFile } from "../engine";

// Google Sans from local files (VIDEO.md §2): a font fetched over the network silently falls back to
// system-ui when there is no network. The render waits until the three weights are really loaded.
const WEIGHTS = [
  ["400", "GoogleSans-Regular.ttf"],
  ["500", "GoogleSans-Medium.ttf"],
  ["700", "GoogleSans-Bold.ttf"]
] as const;

let loaded = false;
function loadFonts() {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("Google Sans");
  Promise.all(
    WEIGHTS.map(([weight, file]) => {
      const face = new FontFace("Google Sans", `url(${staticFile(`fonts/${file}`)})`, { weight });
      (document.fonts as unknown as Set<FontFace>).add(face);
      return face.load();
    })
  )
    .then(() => continueRender(handle))
    .catch((error) => {
      // Fail loudly: a render with the wrong font is worse than no render.
      throw new Error(`Google Sans did not load: ${String(error)}`);
    });
}

export function Fonts() {
  loadFonts();
  return (
    <style>{`* { box-sizing: border-box; -webkit-font-smoothing: antialiased; } body { margin: 0; }`}</style>
  );
}
