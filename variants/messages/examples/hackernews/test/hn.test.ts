import { afterEach, describe, expect, test, vi } from "vitest";
import { getStories, getStory, getUser } from "../src/hn.ts";

afterEach(() => vi.unstubAllGlobals());

describe("hn (browser fetchers)", () => {
  test("feeds, items and users go to the same endpoints as the original; 30186326 comes from the capture", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response("[]", { status: 200 });
    });
    await getStories("job", 2);
    await getStory("123");
    await getStory("30186326");
    await getUser("pg");
    expect(urls).toEqual([
      "https://node-hnapi.herokuapp.com/jobs?page=2",
      "https://node-hnapi.herokuapp.com/item/123",
      "/story-30186326.json",
      "https://hacker-news.firebaseio.com/v0/user/pg.json"
    ]);
  });

  test("an HTTP error rejects (and so reaches Solid as an error)", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503, statusText: "Service Unavailable" }));
    await expect(getStory("1")).rejects.toThrow("503 Service Unavailable");
  });
});
