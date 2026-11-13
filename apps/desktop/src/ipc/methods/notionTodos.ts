import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const NOTION_VERSION = "2022-06-28";

const NotionTodoItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
  status: Schema.NullOr(Schema.String),
  due: Schema.NullOr(Schema.String),
  url: Schema.String,
});
export type NotionTodoItem = typeof NotionTodoItem.Type;

const NotionTodoConfig = Schema.Struct({ token: Schema.String, databaseId: Schema.String });
const NotionTodoConfigJson = Schema.fromJsonString(NotionTodoConfig);
const decodeConfig = Schema.decodeEffect(NotionTodoConfigJson);
const encodeConfig = Schema.encodeEffect(NotionTodoConfigJson);

/** The 32-hex database id inside a Notion link or a bare (dashed) id; null when there is none. */
export function parseNotionDatabaseId(input: string): string | null {
  const path = input.trim().split("?")[0] ?? "";
  const matches = path.replaceAll("-", "").match(/[0-9a-f]{32}/gi);
  return matches?.at(-1)?.toLowerCase() ?? null;
}

const DONE_STATUSES = new Set(["done", "complete", "completed", "tamamlandı", "bitti"]);

function propertyText(parts: unknown): string {
  return Array.isArray(parts)
    ? parts.map((part) => (part as { plain_text?: unknown }).plain_text ?? "").join("")
    : "";
}

/** Reads a database query response into todos: open ones first, then by due date. */
export function parseNotionTodos(response: unknown): ReadonlyArray<NotionTodoItem> {
  const results = (response as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const items = results.flatMap((page): NotionTodoItem[] => {
    const { id, url, properties } = page as {
      id?: unknown;
      url?: unknown;
      properties?: Record<string, { type?: string } & Record<string, unknown>>;
    };
    if (typeof id !== "string" || typeof url !== "string" || !properties) return [];
    const values = Object.values(properties);
    const title = propertyText(values.find((value) => value.type === "title")?.title).trim();
    const checkbox = values.find((value) => value.type === "checkbox")?.checkbox;
    const statusValue = values.find((value) => value.type === "status")?.status as
      | { name?: unknown }
      | null
      | undefined;
    const status = typeof statusValue?.name === "string" ? statusValue.name : null;
    const date = values.find((value) => value.type === "date")?.date as
      | { start?: unknown }
      | null
      | undefined;
    return [
      {
        id,
        title: title || "Untitled",
        done: checkbox === true || (status !== null && DONE_STATUSES.has(status.toLowerCase())),
        status,
        due: typeof date?.start === "string" ? date.start : null,
        url,
      },
    ];
  });
  return items
    .map((item, index) => ({ item, index }))
    .toSorted(
      (left, right) =>
        Number(left.item.done) - Number(right.item.done) ||
        (left.item.due ?? "￿").localeCompare(right.item.due ?? "￿") ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

// The token stays in the main process; the renderer only learns whether one is saved.
const configPath = Effect.fn("desktop.notionTodos.configPath")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  return environment.path.join(environment.homeDirectory, ".t3plus", "notion.json");
});

const readConfig = Effect.fn("desktop.notionTodos.readConfig")(
  function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFileString(yield* configPath());
    return yield* decodeConfig(contents);
  },
  Effect.orElseSucceed(() => null),
);

export const getNotionTodoConfig = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.T3PLUS_NOTION_GET_CONFIG_CHANNEL,
  payload: Schema.Void,
  result: Schema.Struct({ configured: Schema.Boolean }),
  handler: Effect.fn("desktop.ipc.notionTodos.getConfig")(function* () {
    return { configured: (yield* readConfig()) !== null };
  }),
});

export const setNotionTodoConfig = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.T3PLUS_NOTION_SET_CONFIG_CHANNEL,
  payload: Schema.Struct({ token: Schema.String, database: Schema.String }),
  result: Schema.Struct({ error: Schema.NullOr(Schema.String) }),
  handler: Effect.fn("desktop.ipc.notionTodos.setConfig")(function* ({ token, database }) {
    const databaseId = parseNotionDatabaseId(database);
    if (token.trim().length === 0) return { error: "Paste the integration secret." };
    if (databaseId === null) return { error: "That does not look like a Notion database link." };
    const fileSystem = yield* FileSystem.FileSystem;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const path = yield* configPath();
    return yield* Effect.gen(function* () {
      const encoded = yield* encodeConfig({
        token: token.trim(),
        databaseId,
      });
      yield* fileSystem.makeDirectory(environment.path.dirname(path), {
        recursive: true,
        mode: 0o700,
      });
      yield* fileSystem.writeFileString(path, encoded, { mode: 0o600 });
      return { error: null };
    }).pipe(Effect.orElseSucceed(() => ({ error: "Could not save the Notion settings." })));
  }),
});

const decodeNotionError = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

export const listNotionTodos = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.T3PLUS_NOTION_LIST_CHANNEL,
  payload: Schema.Void,
  result: Schema.Struct({
    items: Schema.Array(NotionTodoItem),
    error: Schema.NullOr(Schema.String),
  }),
  handler: Effect.fn("desktop.ipc.notionTodos.list")(function* () {
    const config = yield* readConfig();
    if (config === null) return { items: [], error: "Notion is not connected yet." };
    const http = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(
      `https://api.notion.com/v1/databases/${config.databaseId}/query`,
    ).pipe(
      HttpClientRequest.bearerToken(config.token),
      HttpClientRequest.setHeader("Notion-Version", NOTION_VERSION),
      HttpClientRequest.bodyJsonUnsafe({ page_size: 100 }),
    );
    return yield* Effect.gen(function* () {
      const response = yield* http.execute(request).pipe(
        // A redirect could carry the token to another origin.
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      );
      const body = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        const message = decodeNotionError(body);
        return {
          items: [],
          error:
            message._tag === "Some" ? message.value.message : `Notion answered ${response.status}.`,
        };
      }
      return { items: [...parseNotionTodos(body)], error: null };
    }).pipe(Effect.orElseSucceed(() => ({ items: [], error: "Could not reach Notion." })));
  }),
});
