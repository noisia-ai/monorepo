import localFont from "next/font/local";

// Google Sans, SIL Open Font License 1.1 (public/fonts/OFL.txt).
// WOFF2 files are lossless recompressions of the TTFs beside them (same outlines, tables and
// opsz axis), about 70% lighter; the TTFs stay as the source files.
export const googleSans = localFont({
  src: [
    { path: "../../public/fonts/GoogleSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/GoogleSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/GoogleSans-Bold.woff2", weight: "700", style: "normal" }
  ],
  variable: "--font-google-sans",
  display: "swap"
});
