import { memo, useEffect } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const REFRESH_MS = 5_000;
const GIB = 1024 ** 3;

function loadTone(fraction: number): string {
  return fraction >= 0.9 ? "text-destructive" : fraction >= 0.75 ? "text-warning" : "";
}

/** CPU and memory of the machine running the routed thread, or the primary one. */
export const SidebarHostResources = memo(function SidebarHostResources() {
  const routeTarget = useThreadRouteTarget();
  const draftEnvironmentId = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft"
      ? (store.getDraftSession(routeTarget.draftId)?.environmentId ?? null)
      : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId =
    routeTarget?.kind === "server"
      ? routeTarget.threadRef.environmentId
      : (draftEnvironmentId ?? primaryEnvironmentId);
  const { data, refresh } = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.hostResources({ environmentId, input: {} }),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the host while the window is visible
  useEffect(() => {
    if (environmentId === null) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [environmentId, refresh]);

  if (data === null || data.totalMemoryBytes <= 0) return null;
  const usedMemoryBytes = data.totalMemoryBytes - data.availableMemoryBytes;
  const memoryFraction = usedMemoryBytes / data.totalMemoryBytes;
  const cpuFraction = data.cpuUtilization;

  return (
    // Its own line: the utility row has no room left beside the clock at the default width.
    <SidebarMenuItem className="basis-full">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="flex h-6 w-fit items-center gap-2 px-2 text-xs tabular-nums text-muted-foreground">
              {cpuFraction === null ? null : (
                <span className={loadTone(cpuFraction)}>CPU {Math.round(cpuFraction * 100)}%</span>
              )}
              <span className={loadTone(memoryFraction)}>
                RAM {(usedMemoryBytes / GIB).toFixed(1)}/{Math.round(data.totalMemoryBytes / GIB)}G
              </span>
            </span>
          }
        />
        <TooltipPopup side="top">
          {data.cpuCount} cores · {(data.availableMemoryBytes / GIB).toFixed(1)} GB memory free
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
});
