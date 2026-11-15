import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  backgroundChatPaneThreadRefs,
  chatPaneRestoreTarget,
  chatPanesShowUnfocused,
  closeChatPane,
  isChatSplitOpen,
  commitChatPanes,
  fitChatPaneGrid,
  layoutWithPendingBeside,
  openChatSplit,
  resolveChatPanes,
  SINGLE_CHAT_PANE_LAYOUT,
  swapChatPanes,
  useChatPanesStore,
  type ChatPanesLayout,
} from "./chatPanesStore";
import { DraftId } from "./composerDraftStore";
import type { ThreadRouteTarget } from "./threadRoutes";

const threadRef = (id: string) => scopeThreadRef(EnvironmentId.make("env"), ThreadId.make(id));
const thread = (id: string): ThreadRouteTarget => ({ kind: "server", threadRef: threadRef(id) });
const draft = (id: string): ThreadRouteTarget => ({ kind: "draft", draftId: DraftId.make(id) });

function paneIds() {
  let next = 0;
  return () => `pane-${++next}`;
}

function split(left: ThreadRouteTarget, right: ThreadRouteTarget): ChatPanesLayout {
  return openChatSplit(SINGLE_CHAT_PANE_LAYOUT, {
    routeTarget: left,
    target: right,
    createPaneId: paneIds(),
  });
}

const shown = (layout: ChatPanesLayout, route: ThreadRouteTarget) =>
  resolveChatPanes(layout, route).map((pane) => ({
    id: pane.id,
    target: pane.target.kind === "server" ? pane.target.threadRef.threadId : pane.target.draftId,
    active: pane.active,
  }));

describe("chat panes", () => {
  it("opens beside the routed thread and keeps the routed pane focused", () => {
    const layout = split(thread("a"), thread("b"));
    expect(shown(layout, thread("a"))).toEqual([
      { id: "primary", target: "a", active: true },
      { id: "pane-1", target: "b", active: false },
    ]);
  });

  it("focuses the pane whose thread the route lands on, leaving the other pane as it was", () => {
    const layout = split(thread("a"), thread("b"));
    expect(shown(layout, thread("b"))).toEqual([
      { id: "primary", target: "a", active: false },
      { id: "pane-1", target: "b", active: true },
    ]);
  });

  it("retargets only the focused pane when the route moves to another thread", () => {
    const focusedRight = commitChatPanes(split(thread("a"), thread("b")), thread("b"));
    expect(shown(focusedRight, thread("c"))).toEqual([
      { id: "primary", target: "a", active: false },
      { id: "pane-1", target: "c", active: true },
    ]);
    const committed = commitChatPanes(focusedRight, thread("c"));
    expect(shown(committed, thread("a"))).toEqual([
      { id: "primary", target: "a", active: true },
      { id: "pane-1", target: "c", active: false },
    ]);
  });

  it("counts the unfocused pane's thread as visible only while the split fits", () => {
    const layout = split(thread("a"), thread("b"));
    expect(backgroundChatPaneThreadRefs(layout, thread("a"), true)).toEqual([threadRef("b")]);
    expect(backgroundChatPaneThreadRefs(layout, thread("a"), false)).toEqual([]);
  });

  it("maximizing hides the unfocused panes until shown again, and ends with the split", () => {
    const store = useChatPanesStore;
    store.setState({ layout: SINGLE_CHAT_PANE_LAYOUT, maximized: false, splitFits: true });
    store.getState().toggleMaximized();
    expect(store.getState().maximized).toBe(false);
    store.getState().openSplit({ routeTarget: thread("a"), target: thread("b") });
    store.getState().toggleMaximized();
    expect(chatPanesShowUnfocused(store.getState())).toBe(false);
    store.getState().toggleMaximized();
    expect(chatPanesShowUnfocused(store.getState())).toBe(true);
    store.getState().toggleMaximized();
    const other = store.getState().layout.panes[1]!;
    store.getState().closePane(other.id);
    expect(store.getState().maximized).toBe(false);
  });

  it("commits nothing when the route already matches the layout", () => {
    const layout = split(thread("a"), thread("b"));
    expect(commitChatPanes(layout, thread("a"))).toBe(layout);
  });

  it("keeps a draft pane addressable by its draft id", () => {
    const layout = split(thread("a"), draft("d"));
    expect(shown(layout, draft("d"))).toEqual([
      { id: "primary", target: "a", active: false },
      { id: "pane-1", target: "d", active: true },
    ]);
  });

  it("never shows one thread in two panes", () => {
    expect(split(thread("a"), thread("a"))).toBe(SINGLE_CHAT_PANE_LAYOUT);
    const layout = split(thread("a"), thread("b"));
    expect(
      openChatSplit(layout, {
        routeTarget: thread("a"),
        target: thread("b"),
        createPaneId: paneIds(),
      }),
    ).toBe(layout);
  });

  it("adds panes up to four, then replaces the first unfocused one", () => {
    const ids = paneIds();
    const open = (layout: ChatPanesLayout, target: ThreadRouteTarget) =>
      openChatSplit(layout, { routeTarget: thread("a"), target, createPaneId: ids });
    const four = [thread("b"), thread("c"), thread("d")].reduce(open, SINGLE_CHAT_PANE_LAYOUT);
    expect(shown(four, thread("a")).map((pane) => pane.target)).toEqual(["a", "b", "c", "d"]);
    expect(shown(open(four, thread("e")), thread("a"))).toEqual([
      { id: "primary", target: "a", active: true },
      { id: "pane-1", target: "e", active: false },
      { id: "pane-2", target: "c", active: false },
      { id: "pane-3", target: "d", active: false },
    ]);
  });

  it("opens the next route beside the anchor thread instead of replacing it", () => {
    const pending = { anchor: thread("a"), paneId: "beside" };
    const single = layoutWithPendingBeside(SINGLE_CHAT_PANE_LAYOUT, pending, draft("new"));
    expect(shown(single, draft("new"))).toEqual([
      { id: "primary", target: "a", active: false },
      { id: "beside", target: "new", active: true },
    ]);
    const split3 = layoutWithPendingBeside(split(thread("a"), thread("b")), pending, draft("new"));
    expect(shown(split3, draft("new")).map((pane) => pane.target)).toEqual(["a", "b", "new"]);
    // A route that stays on the anchor, such as a reused draft, leaves the layout alone.
    expect(layoutWithPendingBeside(SINGLE_CHAT_PANE_LAYOUT, pending, thread("a"))).toBe(
      SINGLE_CHAT_PANE_LAYOUT,
    );
  });

  it.each([
    ["two in a row", 2, "row", 800, 600, { columns: 2, rows: 1 }],
    ["two too narrow", 2, "row", 700, 600, null],
    ["three in a row", 3, "row", 1100, 600, { columns: 3, rows: 1 }],
    ["four wrap into two columns", 4, "row", 1000, 600, { columns: 2, rows: 2 }],
    ["three wrap, the last spans", 3, "row", 800, 600, { columns: 2, rows: 2 }],
    ["four too small to wrap", 4, "row", 1000, 400, null],
    ["three stacked", 3, "column", 500, 800, { columns: 1, rows: 3 }],
  ] as const)("fits %s", (_name, count, direction, width, height, expected) => {
    expect(
      fitChatPaneGrid({ count, direction, width, height, minWidth: 360, minHeight: 240 }),
    ).toEqual(expected);
  });

  it("swapping keeps each pane's thread, focus and size", () => {
    const layout = swapChatPanes({ ...split(thread("a"), thread("b")), ratio: 0.7 });
    expect(shown(layout, thread("a"))).toEqual([
      { id: "pane-1", target: "b", active: false },
      { id: "primary", target: "a", active: true },
    ]);
    expect(layout.ratio).toBeCloseTo(0.3);
  });

  it("restarts on the focused pane's thread, and only for a split", () => {
    expect(chatPaneRestoreTarget(SINGLE_CHAT_PANE_LAYOUT)).toBeNull();
    const focusedRight = commitChatPanes(split(thread("a"), thread("b")), thread("b"));
    expect(chatPaneRestoreTarget(focusedRight)).toEqual(thread("b"));
  });

  it("closing the unfocused pane returns to one pane without moving the route", () => {
    const result = closeChatPane(split(thread("a"), thread("b")), "pane-1");
    expect(isChatSplitOpen(result.layout)).toBe(false);
    expect(result.focusTarget).toBeNull();
    // The routed pane keeps its id, so its view stays mounted.
    expect(shown(result.layout, thread("a"))).toEqual([
      { id: "primary", target: "a", active: true },
    ]);
  });

  it("opens a split again for the thread the remaining pane showed before the route moved", () => {
    const closed = closeChatPane(split(thread("a"), thread("b")), "pane-1").layout;
    const reopened = openChatSplit(closed, {
      routeTarget: thread("c"),
      target: thread("a"),
      createPaneId: paneIds(),
    });
    expect(shown(reopened, thread("c"))).toEqual([
      { id: "primary", target: "c", active: true },
      { id: "pane-1", target: "a", active: false },
    ]);
  });

  it("closing the focused pane moves the route to the remaining pane", () => {
    const result = closeChatPane(split(thread("a"), thread("b")), "primary");
    expect(result.focusTarget).toEqual(thread("b"));
    expect(shown(result.layout, thread("b"))).toEqual([
      { id: "pane-1", target: "b", active: true },
    ]);
  });
});
