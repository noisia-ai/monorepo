import { cycleWorkspaceDrawerFocusV1 } from "@/components/workspace/WorkspaceShell";

export function getAdminShellRailAccessibilityStateV1({
  contextNavigationCollapsed,
  globalNavigationCollapsed,
  navigationOpen
}: {
  contextNavigationCollapsed: boolean;
  globalNavigationCollapsed: boolean;
  navigationOpen: boolean;
}) {
  return {
    contextHidden: contextNavigationCollapsed,
    globalHidden: globalNavigationCollapsed && !navigationOpen,
    trapGlobalFocus: globalNavigationCollapsed && navigationOpen
  };
}

export function setAdminShellRailInertV1(
  element: HTMLElement | null,
  inert: boolean
) {
  if (!element) return false;
  element.inert = inert;
  if (inert) element.setAttribute("inert", "");
  else element.removeAttribute("inert");
  return true;
}

export function trapAdminShellMobileNavigationFocusV1(
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "shiftKey">,
  panel: HTMLElement,
  activeElement: Element | null,
  onClose: () => void
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return true;
  }
  if (event.key !== "Tab") return false;
  event.preventDefault();
  cycleWorkspaceDrawerFocusV1(panel, activeElement, event.shiftKey);
  return true;
}
