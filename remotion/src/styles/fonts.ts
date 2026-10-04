import { continueRender, delayRender, staticFile } from "remotion";

/* Fonts are self-hosted from public/fonts so a render needs no network at all.
   Barlow, Barlow Condensed and IBM Plex Mono are SIL Open Font License. */
const handle = delayRender("loading fonts");

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = staticFile("fonts/fonts.css");
link.onload = () => continueRender(handle);
link.onerror = () => continueRender(handle);
document.head.appendChild(link);

/* Make sure the faces are actually rasterised before the first frame. */
if (typeof document !== "undefined" && (document as any).fonts) {
  const h2 = delayRender("rasterising fonts");
  Promise.all([
    (document as any).fonts.load("500 20px Barlow"),
    (document as any).fonts.load("600 20px Barlow"),
    (document as any).fonts.load("700 20px Barlow"),
    (document as any).fonts.load("600 20px 'Barlow Condensed'"),
    (document as any).fonts.load("500 20px 'IBM Plex Mono'"),
  ]).then(() => continueRender(h2)).catch(() => continueRender(h2));
}
