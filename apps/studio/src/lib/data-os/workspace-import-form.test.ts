import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { ImportFailureNotice, ImportForm } from "../../components/admin/AcquisitionPlanManager";

Object.assign(globalThis, { React });
type Props = ComponentProps<typeof ImportForm>;

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  function Fixture({ result = null, busy = false }: { result?: Props["result"]; busy?: boolean }) {
    const t = useTranslations("AdminWorkspace.data.acquisition");
    return createElement(ImportForm, { locale, t, result, busy, timezone: "Europe/Madrid", simple: true,
      readyForImport: true, queries: [], connectors: [], error: null, canCancelUpload: false,
      onCancelUpload() {}, onRefreshStatus() {}, onRegisterQuery() {}, onSubmit() {} });
  }
  const render = (props: ComponentProps<typeof Fixture> = {}) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>, createElement(Fixture, props)));
  test(`${locale}: the file zone uses the searchable IANA catalog and initializes from its workspace`, () => {
    const html = render();
    const input = html.match(/<input[^>]*name="timezone"[^>]*>/u)?.[0];
    assert.ok(input);
    assert.match(input, /type="hidden"/u);
    assert.match(input, /value="Europe\/Madrid"/u);
    assert.doesNotMatch(input, /disabled|readonly/iu);
    assert.match(html, /role="combobox"/u);
    assert.equal((html.match(/name="timezone"/gu) ?? []).length, 1);
    assert.doesNotMatch(html, /<input(?=[^>]*name="timezone")(?=[^>]*type="text")[^>]*>/u);
    assert.ok(html.includes(messages.AdminWorkspace.data.acquisition.fields.fileTimezone));
    assert.ok(html.includes(messages.AdminWorkspace.data.acquisition.fields.fileTimezoneHelp));
  });
  test(`${locale}: an already accepted file does not display a stale 99 percent progress`, () => {
    const result = { id: "local-receipt", status: "failed", phase: "failed", failure: { code: "content_already_accepted", recoverable: false },
      progress: { percent: 99, records_processed: 904 }, final_counts: null, observed: null } as Props["result"];
    const html = render({ result });
    assert.ok(html.includes(messages.AdminWorkspace.data.acquisition.history.alreadyImported));
    assert.doesNotMatch(html, /99|99%/u);
    assert.doesNotMatch(html, new RegExp(messages.AdminWorkspace.data.acquisition.actions.confirmUpload, "u"));
  });
  test(`${locale}: a transfer in progress still shows its reported percentage`, () => {
    const result = { id: "local-receipt", status: "queued", phase: "uploading", failure: null,
      progress: { percent: 42, records_processed: 0 }, final_counts: null, observed: null } as Props["result"];
    assert.match(render({ result, busy: true }), /42/u);
  });
  test(`${locale}: date failures explain the correction in the upload result and shared history notice`, () => {
    for (const code of ["source_timezone_required", "source_timezone_invalid", "source_timestamp_required",
      "source_timestamp_invalid", "source_timestamp_ambiguous", "source_timestamp_nonexistent"]) {
      const result = { id: "local-receipt", status: "failed", phase: "failed", failure: { code, recoverable: false },
        source_file_name: "local.csv", supersedes_import_batch_id: null, acquisition: null, created_at: "2026-09-08T00:00:00Z",
        recovery: { recoverable_from_storage: false }, progress: { percent: null, records_processed: 0, bytes_processed: 0, bytes_total: 10 },
        final_counts: null, observed: null, private_row: "DO_NOT_RENDER_SOURCE_CONTENT" } as Props["result"];
      const html = render({ result });
      const expected = messages.AdminWorkspace.data.acquisition.importFailures[code];
      assert.ok(html.includes(expected), `${code} has no actionable explanation`);
      assert.doesNotMatch(html, /DO_NOT_RENDER_SOURCE_CONTENT/u);
      assert.doesNotMatch(html, new RegExp(messages.AdminWorkspace.data.acquisition.actions.confirmUpload, "u"));
      function HistoryNotice() {
        const t = useTranslations("AdminWorkspace.data.acquisition");
        return createElement(ImportFailureNotice, { item: result!, t, compact: true });
      }
      const history = renderToStaticMarkup(createElement(NextIntlClientProvider,
        { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>, createElement(HistoryNotice)));
      assert.equal(history, `<small>${expected}</small>`);
    }
  });
}
