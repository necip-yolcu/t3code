import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, RotateCwIcon, XIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { usePreviewWebviewConfig } from "../../browser/previewWebviewConfigState";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { Button } from "../ui/button";
import { DialogBackdrop } from "../ui/dialog";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// A per-device convenience: the T3+ owner's tracker page, kept out of synced settings.
const TRACKER_URL_KEY = "t3plus:tracker-url";

function readTrackerUrl(): string | null {
  try {
    return parseTrackerUrl(window.localStorage.getItem(TRACKER_URL_KEY) ?? "");
  } catch {
    return null;
  }
}

function parseTrackerUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function openExternally(url: string) {
  void ensureLocalApi()
    .shell.openExternal(url)
    .catch(() => undefined);
}

function HeaderButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={props.label} onClick={props.onClick} size="icon-sm" variant="ghost" />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** The page in T3's own browser profile, so a sign-in made in the preview browser carries over. */
function TrackerWebview(props: { environmentId: EnvironmentId; url: string }) {
  const config = usePreviewWebviewConfig(props.environmentId);
  if (!config) return null;
  return (
    <webview
      className="absolute inset-0 size-full"
      src={props.url}
      partition={config.partition}
      webpreferences={config.webPreferences}
      // Electron needs allowpopups at attachment; the desktop window-open handler decides each one.
      {...({ allowpopups: "true" } as unknown as { readonly allowpopups?: boolean })}
    />
  );
}

/** T3+ only: a work tracker page, such as a claude.ai artifact, one click from the sidebar. */
export function TrackerModal(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [url, setUrl] = useState(readTrackerUrl);
  const [draft, setDraft] = useState<string | null>(() => (url === null ? "" : null));
  const [generation, setGeneration] = useState(0);
  const draftUrl = draft === null ? null : parseTrackerUrl(draft);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (draftUrl === null) return;
    try {
      window.localStorage.setItem(TRACKER_URL_KEY, draftUrl);
    } catch {
      // Still shown for this session.
    }
    setUrl(draftUrl);
    setDraft(null);
  };

  return (
    // Sign-in popups take focus from the page, which would otherwise close the modal.
    <DialogPrimitive.Root
      disablePointerDismissal
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogPrimitive.Portal>
        <DialogBackdrop />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 lg:p-10">
          <DialogPrimitive.Popup
            aria-label="Tracker"
            className="flex size-full max-h-[60rem] max-w-[80rem] flex-col overflow-hidden rounded-2xl border bg-background text-foreground shadow-2xl/40 outline-none [-webkit-app-region:no-drag]"
          >
            <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
              {draft !== null ? (
                <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={save}>
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label="Tracker link"
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="https://claude.ai/artifact/…"
                      size="sm"
                      value={draft}
                    />
                  </div>
                  <Button disabled={draftUrl === null} size="sm" type="submit">
                    Save
                  </Button>
                  {url !== null ? (
                    <Button onClick={() => setDraft(null)} size="sm" type="button" variant="ghost">
                      Cancel
                    </Button>
                  ) : null}
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                    {url}
                  </span>
                  <HeaderButton label="Change link" onClick={() => setDraft(url ?? "")}>
                    <PencilIcon />
                  </HeaderButton>
                  <HeaderButton label="Reload" onClick={() => setGeneration((value) => value + 1)}>
                    <RotateCwIcon />
                  </HeaderButton>
                  {url !== null ? (
                    <HeaderButton label="Open in browser" onClick={() => openExternally(url)}>
                      <ExternalLinkIcon />
                    </HeaderButton>
                  ) : null}
                </>
              )}
              <DialogPrimitive.Close
                aria-label="Close"
                render={<Button size="icon-sm" variant="ghost" />}
              >
                <XIcon />
              </DialogPrimitive.Close>
            </div>
            <div className="relative min-h-0 flex-1">
              {url === null ? (
                <p className="p-6 text-muted-foreground text-sm">
                  Paste the link of the page you track your work in. It opens here, signed in like
                  T3's browser.
                </p>
              ) : window.desktopBridge && primaryEnvironmentId !== null ? (
                <TrackerWebview
                  environmentId={primaryEnvironmentId}
                  key={`${url}:${generation}`}
                  url={url}
                />
              ) : (
                <div className="flex flex-col items-start gap-3 p-6 text-muted-foreground text-sm">
                  <p>This page can only be shown inside the T3+ desktop app.</p>
                  <Button onClick={() => openExternally(url)} size="sm" variant="outline">
                    <ExternalLinkIcon />
                    Open in browser
                  </Button>
                </div>
              )}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
