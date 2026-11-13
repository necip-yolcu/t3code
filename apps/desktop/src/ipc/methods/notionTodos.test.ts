import { describe, expect, it } from "vite-plus/test";

import { parseNotionDatabaseId, parseNotionTodos } from "./notionTodos.ts";

const ID = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";

describe("parseNotionDatabaseId", () => {
  it.each([
    [`https://www.notion.so/team/Todos-${ID}?v=${"f".repeat(32)}`, ID],
    ["1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d", ID],
    [ID.toUpperCase(), ID],
    ["https://www.notion.so/team/no-id-here", null],
  ])("reads %s", (input, expected) => {
    expect(parseNotionDatabaseId(input)).toBe(expected);
  });
});

describe("parseNotionTodos", () => {
  const page = (id: string, properties: Record<string, unknown>) => ({
    id,
    url: `https://www.notion.so/${id}`,
    properties,
  });
  const title = (text: string) => ({ type: "title", title: [{ plain_text: text }] });

  it("puts open todos first by due date and reads done from a checkbox or a done status", () => {
    const items = parseNotionTodos({
      results: [
        page("a", { Name: title("Later"), Due: { type: "date", date: { start: "2026-12-01" } } }),
        page("b", { Name: title("Shipped"), Done: { type: "checkbox", checkbox: true } }),
        page("c", { Name: title("Soon"), Due: { type: "date", date: { start: "2026-11-20" } } }),
        page("d", {
          Name: title("Reviewed"),
          Status: { type: "status", status: { name: "Done" } },
        }),
        page("e", {
          Name: title("Undated"),
          Status: { type: "status", status: { name: "Doing" } },
        }),
        { id: "broken" },
      ],
    });
    expect(items.map((item) => [item.title, item.done, item.status, item.due])).toEqual([
      ["Soon", false, null, "2026-11-20"],
      ["Later", false, null, "2026-12-01"],
      ["Undated", false, "Doing", null],
      ["Shipped", true, null, null],
      ["Reviewed", true, "Done", null],
    ]);
  });

  it("reads nothing from a response without results", () => {
    expect(parseNotionTodos({ object: "error" })).toEqual([]);
  });
});
