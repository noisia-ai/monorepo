import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import {
  localeCookieName,
  resolveRequestLocale
} from "@/i18n/locales";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(localeCookieName)?.value;
  const locale = resolveRequestLocale(cookieLocale);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});
