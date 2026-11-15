import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { type AnyRouter, useRouter } from "@tanstack/react-router";

import { isChatSplitOpen, useChatPanesStore } from "../chatPanesStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteTarget,
  type ThreadRouteTarget,
} from "../threadRoutes";

/**
 * Split pane actions for entry points outside the panes: the sidebar, the command palette and
 * shortcuts. The route shows the focused pane, so each focus change is a navigation.
 */
export function createChatPaneCommands(router: AnyRouter) {
  const readRouteTarget = () => resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const navigateTo = (target: ThreadRouteTarget, replace = false) =>
    void (target.kind === "server"
      ? router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(target.threadRef),
          replace,
        })
      : router.navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(target.draftId),
          replace,
        }));

  /** Opens `threadRef` beside the routed thread and focuses it; false with no thread routed. */
  const openInSplit = (threadRef: ScopedThreadRef): boolean => {
    const routeTarget = readRouteTarget();
    if (routeTarget === null) return false;
    useChatPanesStore.getState().openSplit({ routeTarget, target: { kind: "server", threadRef } });
    navigateTo({ kind: "server", threadRef });
    return true;
  };

  /** Focuses the pane `offset` places after the focused one, wrapping around. */
  const focusPaneAt = (offset: 1 | -1) => {
    const { layout } = useChatPanesStore.getState();
    if (!isChatSplitOpen(layout)) return;
    const index = layout.panes.findIndex((pane) => pane.id === layout.activePaneId);
    const next = layout.panes.at((index + offset) % layout.panes.length);
    if (next && next.id !== layout.activePaneId) navigateTo(next.target);
  };

  const closeFocusedPane = () => {
    const store = useChatPanesStore.getState();
    const { activePaneId } = store.layout;
    if (activePaneId === null) return;
    const focusTarget = store.closePane(activePaneId);
    if (focusTarget) navigateTo(focusTarget);
  };

  /**
   * Closes the pane showing a thread that is gone. True when that moved the route to the other
   * pane, so the caller skips its own fallback navigation.
   */
  const closePaneShowing = (threadRef: ScopedThreadRef): boolean => {
    const store = useChatPanesStore.getState();
    if (!isChatSplitOpen(store.layout)) return false;
    const key = scopedThreadKey(threadRef);
    const pane = store.layout.panes.find(
      (candidate) =>
        candidate.target.kind === "server" && scopedThreadKey(candidate.target.threadRef) === key,
    );
    if (!pane) return false;
    const focusTarget = store.closePane(pane.id);
    // The removal can finish after the user left the thread, for example for Settings.
    const routeTarget = readRouteTarget();
    const routeShowsRemoved =
      routeTarget?.kind === "server" && scopedThreadKey(routeTarget.threadRef) === key;
    if (focusTarget === null || !routeShowsRemoved) return false;
    // Replaces the removed thread's history entry, as the single-pane fallback does.
    navigateTo(focusTarget, true);
    return true;
  };

  /** Back to one pane, keeping the focused one; the route already shows it. */
  const closeOtherPanes = () => {
    const store = useChatPanesStore.getState();
    for (const pane of store.layout.panes) {
      if (pane.id !== store.layout.activePaneId) store.closePane(pane.id);
    }
  };

  /**
   * Runs `start`, whose navigation lands in a new pane beside the routed thread instead of
   * replacing it, such as a new thread opened from the project picker.
   */
  const openNextRouteBeside = async (start: () => Promise<unknown>) => {
    const anchor = readRouteTarget();
    if (anchor === null) {
      await start();
      return;
    }
    const clear = useChatPanesStore.getState().openNextBeside(anchor);
    try {
      await start();
    } finally {
      // A request that never left the anchor (a reused draft, an abandoned one) must not carry
      // the flag to a later navigation; one that left it was taken by the pane commit.
      const route = readRouteTarget();
      const left =
        route !== null &&
        (route.kind !== anchor.kind ||
          (route.kind === "server" && anchor.kind === "server"
            ? scopedThreadKey(route.threadRef) !== scopedThreadKey(anchor.threadRef)
            : route.kind === "draft" &&
              anchor.kind === "draft" &&
              route.draftId !== anchor.draftId));
      if (!left) clear();
    }
  };

  return {
    openInSplit,
    openNextRouteBeside,
    focusNextPane: () => focusPaneAt(1),
    focusPreviousPane: () => focusPaneAt(-1),
    focusOtherPane: () => focusPaneAt(1),
    closeFocusedPane,
    closeOtherPanes,
    closePaneShowing,
  };
}

export function useChatPaneCommands() {
  return createChatPaneCommands(useRouter());
}
