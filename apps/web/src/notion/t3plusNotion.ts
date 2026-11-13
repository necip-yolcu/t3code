/** A todo from the connected Notion database, as the T3+ desktop app reads it. */
export interface NotionTodoItem {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly status: string | null;
  readonly due: string | null;
  readonly url: string;
}

/** T3+ desktop only: the main process holds the Notion token and makes the requests. */
export interface T3plusNotionBridge {
  readonly getConfig: () => Promise<{ readonly configured: boolean }>;
  readonly setConfig: (config: {
    readonly token: string;
    readonly database: string;
  }) => Promise<{ readonly error: string | null }>;
  readonly listTodos: () => Promise<{
    readonly items: ReadonlyArray<NotionTodoItem>;
    readonly error: string | null;
  }>;
}

declare global {
  interface Window {
    t3plusNotion?: T3plusNotionBridge;
  }
}

export function readT3plusNotion(): T3plusNotionBridge | null {
  return typeof window === "undefined" ? null : (window.t3plusNotion ?? null);
}
