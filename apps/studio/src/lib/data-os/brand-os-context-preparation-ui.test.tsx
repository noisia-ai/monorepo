import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import { BrandOsContextPreparation } from "../../components/brands/BrandOsContextPreparation";
import { SemanticContextPackManager } from "../../components/brands/SemanticContextPackManager";
Object.assign(globalThis, { React });

test("Brand OS MFP routes to corpus Data while standard context UI remains identical in ES/EN", async () => {
  const props = { brandId: "synthetic-brand", workspaceId: "synthetic-workspace", allowProcessingAuthorization: true };
  for (const locale of ["es-MX", "en-US"] as const) {
    const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
    const render = (child: React.ReactNode) => renderToStaticMarkup(createElement(NextIntlClientProvider,
      { locale, messages, timeZone: "UTC", children: child, onError: (error: Error) => { throw error; } } as ComponentProps<typeof NextIntlClientProvider>));
    const mfp = render(createElement(BrandOsContextPreparation, { ...props, mfpEnabled: true }));
    assert.ok(mfp.includes(messages.AdminWorkspace.brandOs.mfpContext.body));
    assert.match(mfp, /href="\/studio\/brands\/synthetic-brand\/data"/u);
    assert.doesNotMatch(mfp, /semantic-context-pack|brand-context-processing/u,
      "the MFP notice must not mount the unrelated semantic authorization reader");
    assert.equal(render(createElement(BrandOsContextPreparation, { ...props, mfpEnabled: false })),
      render(createElement(SemanticContextPackManager, { workspaceId: props.workspaceId, allowProcessingAuthorization: true })),
      "non-MFP keeps the standard context UI and authorization behavior unchanged");
  }
});
