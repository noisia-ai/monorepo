import Script from "next/script";

// The GA4 property noisia.ai has used since the 2026-05 site.
const DEFAULT_ID = "G-CPCFPVBDTP";

/** Google Analytics 4 in production; staging (NOISIA_UAT=1) and development send nothing. */
export function Analytics() {
  if (process.env.NOISIA_UAT === "1" || process.env.NODE_ENV !== "production") return null;
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || DEFAULT_ID;
  if (!id) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});`}
      </Script>
    </>
  );
}
