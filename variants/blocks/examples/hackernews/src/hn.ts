// The HN data source, fetched from the browser (ported from the original's
// server/hn.ts). node-hnapi answers with Access-Control-Allow-Origin: *, and
// the Firebase user API echoes the Origin, so plain GETs work. The original's
// User-Agent header is dropped: browsers do not let pages set it.
import type { StoryDefinition, StoryTypes, UserDefinition } from "./types.ts";

const story = (path: string) => `https://node-hnapi.herokuapp.com/${path}`;
const user = (path: string) => `https://hacker-news.firebaseio.com/v0/${path}.json`;

/**
 * One thread is served from the original's capture (30186326, 1,406 comments)
 * instead of the network, as a static file in public/.
 */
const CACHED_STORY_ID = "30186326";

const mapStories = { top: "news", new: "newest", show: "show", ask: "ask", job: "jobs" } as const;

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return response.json() as Promise<T>;
}

export const hn = {
  getStories: (type: StoryTypes, page: number) => fetchJSON<StoryDefinition[]>(story(`${mapStories[type]}?page=${page}`)),
  getStory: (id: string) =>
    fetchJSON<StoryDefinition>(id === CACHED_STORY_ID ? `${import.meta.env.BASE_URL}story-${CACHED_STORY_ID}.json` : story(`item/${id}`)),
  async getUser(id: string) {
    const found = await fetchJSON<UserDefinition | null>(user(`user/${id}`));
    if (!found) throw new Error(`No user ${id}`);
    return found;
  }
};

export type Hn = typeof hn;
