import localFont from "next/font/local";

// Google Sans, SIL Open Font License 1.1 (public/fonts/OFL.txt).
export const googleSans = localFont({
  src: [
    { path: "../../public/fonts/GoogleSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/GoogleSans-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/GoogleSans-Bold.ttf", weight: "700", style: "normal" }
  ],
  variable: "--font-google-sans",
  display: "swap"
});
