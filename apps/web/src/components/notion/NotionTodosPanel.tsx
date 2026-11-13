import { CircleCheckIcon, CircleIcon, ListTodoIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { readLocalApi } from "~/localApi";
import {
  type NotionTodoItem,
  readT3plusNotion,
  type T3plusNotionBridge,
} from "~/notion/t3plusNotion";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";

type PanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "setup"; readonly error: string | null }
  | {
      readonly kind: "list";
      readonly items: ReadonlyArray<NotionTodoItem>;
      readonly error: string | null;
    };

const dueFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

function formatDue(due: string): string {
  const date = new Date(due.length === 10 ? `${due}T00:00:00` : due);
  return Number.isNaN(date.getTime()) ? due : dueFormat.format(date);
}

async function readPanelState(bridge: T3plusNotionBridge): Promise<PanelState> {
  const { configured } = await bridge.getConfig();
  if (!configured) return { kind: "setup", error: null };
  const result = await bridge.listTodos();
  return { kind: "list", items: result.items, error: result.error };
}

/** T3+ only: the connected Notion database's todos, read-only. */
export function NotionTodosPanel() {
  const bridge = readT3plusNotion();
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    if (!bridge) return;
    setRefreshing(true);
    void readPanelState(bridge)
      .then(setState)
      .finally(() => setRefreshing(false));
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the Notion database on open and whenever the window regains focus
  useEffect(() => {
    if (!bridge) return;
    const read = () => void readPanelState(bridge).then(setState);
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [bridge]);

  if (!bridge) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <ListTodoIcon />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>Notion todos</EmptyTitle>
          <EmptyDescription>Available in the T3+ desktop app.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (state.kind === "loading") return null;
  if (state.kind === "setup") {
    return (
      <NotionTodosSetup
        error={state.error}
        onSave={async (config) => {
          const { error } = await bridge.setConfig(config);
          if (error) setState({ kind: "setup", error });
          else refresh();
        }}
      />
    );
  }

  const open = state.items.filter((item) => !item.done).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {open} open of {state.items.length}
        </span>
        <Button
          size="compact"
          variant="ghost"
          onClick={() => setState({ kind: "setup", error: null })}
        >
          Change
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh Notion todos"
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={refresh}
        >
          <RefreshIcon size="sm" refreshing={refreshing} />
        </Button>
      </div>
      {state.error ? (
        <p className="shrink-0 px-3 py-2 text-destructive-foreground text-xs">{state.error}</p>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col py-1">
          {state.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent"
                aria-label={`Open ${item.title} in Notion`}
                onClick={() => void readLocalApi()?.shell.openExternal(item.url)}
              >
                {item.done ? (
                  <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={
                    item.done
                      ? "min-w-0 flex-1 text-muted-foreground text-sm line-through"
                      : "min-w-0 flex-1 text-sm"
                  }
                >
                  {item.title}
                </span>
                {item.status && !item.done ? (
                  <Badge size="sm" variant="secondary">
                    {item.status}
                  </Badge>
                ) : null}
                {item.due ? (
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    {formatDue(item.due)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function NotionTodosSetup(props: {
  error: string | null;
  onSave: (config: { token: string; database: string }) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [database, setDatabase] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void props.onSave({ token, database }).finally(() => setSaving(false));
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-sm">Connect a Notion database</h3>
        <p className="text-muted-foreground text-xs">
          Create an internal integration at notion.so/profile/integrations, share your todo database
          with it, then paste its secret and the database link. The secret stays on this computer.
        </p>
      </div>
      <Input
        type="password"
        size="sm"
        placeholder="Integration secret"
        autoComplete="off"
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <Input
        size="sm"
        placeholder="Database link"
        value={database}
        onChange={(event) => setDatabase(event.target.value)}
      />
      {props.error ? <p className="text-destructive-foreground text-xs">{props.error}</p> : null}
      <Button type="submit" size="compact" disabled={saving || !token || !database}>
        Connect
      </Button>
    </form>
  );
}
