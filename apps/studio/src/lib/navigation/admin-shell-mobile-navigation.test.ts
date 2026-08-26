import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getAdminShellRailAccessibilityStateV1,
  setAdminShellRailInertV1,
  trapAdminShellMobileNavigationFocusV1
} from "./admin-shell-accessibility";
import { restoreWorkspaceDrawerFocusV1 } from "@/components/workspace/WorkspaceShell";

test("closed responsive Admin rails are hidden and inert without changing desktop navigation", () => {
  assert.deepEqual(getAdminShellRailAccessibilityStateV1({
    contextNavigationCollapsed: true,
    globalNavigationCollapsed: true,
    navigationOpen: false
  }), {
    contextHidden: true,
    globalHidden: true,
    trapGlobalFocus: false
  });
  assert.deepEqual(getAdminShellRailAccessibilityStateV1({
    contextNavigationCollapsed: true,
    globalNavigationCollapsed: true,
    navigationOpen: true
  }), {
    contextHidden: true,
    globalHidden: false,
    trapGlobalFocus: true
  });
  assert.deepEqual(getAdminShellRailAccessibilityStateV1({
    contextNavigationCollapsed: false,
    globalNavigationCollapsed: false,
    navigationOpen: false
  }), {
    contextHidden: false,
    globalHidden: false,
    trapGlobalFocus: false
  });
});

test("mobile Admin navigation traps Tab and closes on Escape", () => {
  let focused = "";
  let prevented = false;
  let closed = false;
  const createControl = (name: string) => {
    const control = {
      disabled: false,
      hidden: false,
      isConnected: true,
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ display: "block", visibility: "visible" })
        }
      },
      getAttribute: () => null,
      closest: () => null,
      getClientRects: () => [{}],
      focus: () => { focused = name; }
    };
    return control;
  };
  const closeButton = createControl("close");
  const firstLink = createControl("first-link");
  const panel = {
    querySelectorAll: () => [closeButton, firstLink]
  } as unknown as HTMLElement;

  assert.equal(trapAdminShellMobileNavigationFocusV1({
    key: "Tab",
    preventDefault: () => { prevented = true; },
    shiftKey: false
  }, panel, closeButton as unknown as Element, () => { closed = true; }), true);
  assert.equal(prevented, true);
  assert.equal(focused, "first-link");
  assert.equal(closed, false);

  prevented = false;
  assert.equal(trapAdminShellMobileNavigationFocusV1({
    key: "Tab",
    preventDefault: () => { prevented = true; },
    shiftKey: false
  }, panel, firstLink as unknown as Element, () => { closed = true; }), true);
  assert.equal(prevented, true);
  assert.equal(focused, "close", "forward Tab wraps to the first control");

  prevented = false;
  assert.equal(trapAdminShellMobileNavigationFocusV1({
    key: "Tab",
    preventDefault: () => { prevented = true; },
    shiftKey: true
  }, panel, closeButton as unknown as Element, () => { closed = true; }), true);
  assert.equal(prevented, true);
  assert.equal(focused, "first-link", "reverse Tab wraps to the last control");

  prevented = false;
  assert.equal(trapAdminShellMobileNavigationFocusV1({
    key: "Escape",
    preventDefault: () => { prevented = true; },
    shiftKey: false
  }, panel, firstLink as unknown as Element, () => { closed = true; }), true);
  assert.equal(prevented, true);
  assert.equal(closed, true);

  const opener = createControl("opener");
  assert.equal(restoreWorkspaceDrawerFocusV1(opener as unknown as HTMLElement), true);
  assert.equal(focused, "opener", "closing restores focus to the captured opener");
});

test("React 18 fail-before drops boolean inert while the runtime primitive sets and removes native inert", () => {
  const warnings: string[] = [];
  const originalError = console.error;
  console.error = (...parts: unknown[]) => warnings.push(parts.map(String).join(" "));
  let brokenMarkup = "";
  try {
    brokenMarkup = renderToStaticMarkup(createElement(
      "aside",
      { "aria-hidden": true, inert: true } as never,
      createElement("a", { href: "#target" }, "Target")
    ));
  } finally {
    console.error = originalError;
  }
  assert.doesNotMatch(brokenMarkup, /\sinert(?:=|>)/u);
  assert.match(warnings.join("\n"), /non-boolean attribute.*inert/su);
  const correctedMarkup = renderToStaticMarkup(createElement(
    "aside",
    { "aria-hidden": true },
    createElement("a", { href: "#target" }, "Target")
  ));
  assert.match(correctedMarkup, /aria-hidden="true"/u);
  assert.doesNotMatch(correctedMarkup, /\sinert(?:=|>)/u);

  const attributes = new Map<string, string>();
  const rail = {
    inert: false,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => { attributes.delete(name); },
    setAttribute: (name: string, value: string) => { attributes.set(name, value); }
  } as unknown as HTMLElement;
  assert.equal(setAdminShellRailInertV1(rail, true), true);
  assert.equal(rail.inert, true);
  assert.equal(rail.getAttribute("inert"), "");
  assert.equal(setAdminShellRailInertV1(rail, false), true);
  assert.equal(rail.inert, false);
  assert.equal(rail.getAttribute("inert"), null);
});

test("Admin shell wires native rail inert, focus containment and opener restoration", async () => {
  const source = await readFile(
    new URL("../../components/workspace/AdminShell.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /\sinert=\{/u);
  assert.match(source, /setAdminShellRailInertV1\([\s\S]+admin-global-navigation[\s\S]+railState\.globalHidden/u);
  assert.match(source, /setAdminShellRailInertV1\([\s\S]+admin-context-navigation[\s\S]+railState\.contextHidden/u);
  assert.match(source, /aria-hidden=\{railState\.globalHidden \|\| undefined\}/u);
  assert.match(source, /aria-hidden=\{railState\.contextHidden \|\| undefined\}/u);
  assert.match(source, /const returnFocusTo = navigationOpenerRef\.current[\s\S]+trapAdminShellMobileNavigationFocusV1\([\s\S]+restoreWorkspaceDrawerFocusV1\(returnFocusTo\)/u);
  assert.match(source, /aria-label=\{t\("navigation\.close"\)\}/u);
});
