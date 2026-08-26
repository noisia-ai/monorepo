import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getAdminShellRailAccessibilityStateV1,
  trapAdminShellMobileNavigationFocusV1
} from "./admin-shell-accessibility";

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
    key: "Escape",
    preventDefault: () => { prevented = true; },
    shiftKey: false
  }, panel, firstLink as unknown as Element, () => { closed = true; }), true);
  assert.equal(prevented, true);
  assert.equal(closed, true);
});

test("Admin shell wires responsive rail state, focus containment and opener restoration", async () => {
  const source = await readFile(
    new URL("../../components/workspace/AdminShell.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /aria-hidden=\{railState\.globalHidden \|\| undefined\}[\s\S]+inert=\{railState\.globalHidden \|\| undefined\}/u);
  assert.match(source, /aria-hidden=\{railState\.contextHidden \|\| undefined\}[\s\S]+inert=\{railState\.contextHidden \|\| undefined\}/u);
  assert.match(source, /const returnFocusTo = navigationOpenerRef\.current[\s\S]+trapAdminShellMobileNavigationFocusV1\([\s\S]+restoreWorkspaceDrawerFocusV1\(returnFocusTo\)/u);
  assert.match(source, /aria-label=\{t\("navigation\.close"\)\}/u);
});
