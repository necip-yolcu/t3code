import { RegistryContext } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, HostResourcesSnapshot } from "@t3tools/contracts";
import { memo, useContext, useEffect, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentPresentation } from "../../state/presentation";
import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const REFRESH_MS = 5_000;
const GIB = 1024 ** 3;

function loadTone(fraction: number): string {
  return fraction >= 0.9 ? "text-destructive" : fraction >= 0.75 ? "text-warning" : "";
}

interface HostSample {
  readonly environmentId: EnvironmentId;
  readonly value: HostResourcesSnapshot;
  /** The latest poll failed, so `value` is the last one this machine answered. */
  readonly stale: boolean;
}

/** The machine's latest answer, kept through failed polls, or null until it first answers. */
function useHostResources(environmentId: EnvironmentId | null): HostSample | null {
  const registry = useContext(RegistryContext);
  const [sample, setSample] = useState<HostSample | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the host while the window is visible
  useEffect(() => {
    if (environmentId === null) return;
    let active = true;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await runAtomCommand(
        registry,
        serverEnvironment.readHostResources,
        { environmentId, input: {} },
        { label: "Read host resources", reportFailure: false, reportDefect: false },
      );
      if (!active) return;
      setSample((previous) => {
        if (result._tag === "Success") return { environmentId, value: result.value, stale: false };
        return previous?.environmentId === environmentId ? { ...previous, stale: true } : previous;
      });
    };
    void read();
    const interval = setInterval(read, REFRESH_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", read);
    };
  }, [environmentId, registry]);

  return sample?.environmentId === environmentId ? sample : null;
}

/**
 * CPU and memory of the machine running the routed thread. Falls back to the primary machine
 * while that one has no answer, such as an older server or a dropped connection.
 */
export const SidebarHostResources = memo(function SidebarHostResources() {
  const routeTarget = useThreadRouteTarget();
  const draftEnvironmentId = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft"
      ? (store.getDraftSession(routeTarget.draftId)?.environmentId ?? null)
      : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const routeEnvironmentId =
    routeTarget?.kind === "server" ? routeTarget.threadRef.environmentId : draftEnvironmentId;
  const routedId = routeEnvironmentId === primaryEnvironmentId ? null : routeEnvironmentId;
  const routed = useHostResources(routedId);
  const primary = useHostResources(primaryEnvironmentId);
  const sample = routed ?? primary;
  const { presentation } = useEnvironmentPresentation(
    routed !== null ? routedId : primaryEnvironmentId,
  );

  if (sample === null || sample.value.totalMemoryBytes <= 0) return null;
  const data = sample.value;
  const usedMemoryBytes = data.totalMemoryBytes - data.availableMemoryBytes;
  const memoryFraction = usedMemoryBytes / data.totalMemoryBytes;
  const cpuFraction = data.cpuUtilization;
  const machine = presentation?.entry.target.label;

  return (
    // Its own line: the utility row has no room left beside the clock at the default width.
    <SidebarMenuItem className="basis-full">
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "flex h-6 w-fit items-center gap-2 px-2 text-xs tabular-nums text-muted-foreground",
                sample.stale && "opacity-50",
              )}
            >
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
          {machine ? `${machine} · ` : null}
          {data.cpuCount} cores · {(data.availableMemoryBytes / GIB).toFixed(1)} GB memory free
          {sample.stale ? (
            <>
              <br />
              Not responding; showing its last reading.
            </>
          ) : null}
          {routedId !== null && routed === null ? (
            <>
              <br />
              This thread's machine doesn't report its usage.
            </>
          ) : null}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
});
