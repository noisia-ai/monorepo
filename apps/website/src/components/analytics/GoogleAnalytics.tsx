"use client";

import { Suspense, useEffect } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";

type GtagCommand =
  | [command: "js", date: Date]
  | [command: "config", targetId: string, config?: Record<string, unknown>]
  | [command: "event", eventName: string, params?: Record<string, unknown>];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagCommand) => void;
  }
}

const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-CPCFPVBDTP";

function ensureGtag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag(...args: GtagCommand) {
      window.dataLayer?.push(args);
    };
}

function PageViewTracker({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) {
      return;
    }

    ensureGtag();

    const queryString = searchParams.toString();
    const pagePath = queryString ? `${pathname}?${queryString}` : pathname;

    window.gtag?.("config", measurementId, {
      page_path: pagePath
    });
  }, [measurementId, pathname, searchParams]);

  return null;
}

export function GoogleAnalytics() {
  if (!GA_MEASUREMENT_ID) {
    return null;
  }

  const encodedMeasurementId = encodeURIComponent(GA_MEASUREMENT_ID);
  const serializedMeasurementId = JSON.stringify(GA_MEASUREMENT_ID);

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodedMeasurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          window.gtag = window.gtag || gtag;
          window.gtag("js", new Date());
          window.gtag("config", ${serializedMeasurementId}, { send_page_view: false });
        `}
      </Script>
      <Suspense fallback={null}>
        <PageViewTracker measurementId={GA_MEASUREMENT_ID} />
      </Suspense>
    </>
  );
}
