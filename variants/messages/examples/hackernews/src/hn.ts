// The HN data source, fetched from the browser (the original runs this on the
// server through "use server"). Both APIs send CORS headers: node-hnapi with
// `*`, Firebase by echoing the origin. No custom headers (the original's
// User-Agent would force a preflight, and browsers don't let pages set it).
import type { StoryDefinition, StoryTypes, UserDefinition } from "./types.ts";

const story = (path: string) => `https://node-hnapi.herokuapp.com/${path}`;
const user = (path: string) => `https://hacker-news.firebaseio.com/v0/${path}.json`;

/** Thread 30186326 (1,406 comments, 14 levels deep) is served from the
 * original's capture, as a static file so it stays out of the bundle. */
export const CACHED_STORY_ID = "30186326";
const CACHED_STORY_URL = `${import.meta.env.BASE_URL}story-${CACHED_STORY_ID}.json`;

const mapStories = {
  top: "news",
  new: "newest",
  show: "show",
  ask: "ask",
  job: "jobs"
} as const;

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return response.json() as Promise<T>;
}

export async function getStories(type: StoryTypes, page: number): Promise<StoryDefinition[]> {
  return fetchJSON(story(`${mapStories[type]}?page=${page}`));
}

export async function getStory(id: string): Promise<StoryDefinition> {
  return fetchJSON(id === CACHED_STORY_ID ? CACHED_STORY_URL : story(`item/${id}`));
}

export async function getUser(id: string): Promise<UserDefinition | null> {
  return fetchJSON(user(`user/${id}`));
}

export const hn = { getStories, getStory, getUser };

/** Browser navigation: the URL is an output of the model (see pushUrl). */
export const nav = {
  push(url: string) {
    if (location.pathname + location.search !== url) history.pushState(null, "", url);
    window.scrollTo(0, 0);
  }
};
