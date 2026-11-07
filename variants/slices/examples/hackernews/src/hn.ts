// The HN data source, fetched from the browser: the same endpoints as the
// original's server/hn.ts (both send CORS headers). Story 30186326 is served
// from a static capture (public/story-30186326.json), as the original did.
// Responses are kept for a minute, so a hover preload serves the click.
import type { StoryDefinition, StoryTypes, UserDefinition } from "./types";

const story = (path: string) => `https://node-hnapi.herokuapp.com/${path}`;
const user = (path: string) => `https://hacker-news.firebaseio.com/v0/${path}.json`;
const CACHED_STORY_ID = "30186326";

const mapStories = {
  top: "news",
  new: "newest",
  show: "show",
  ask: "ask",
  job: "jobs"
} as const;

async function fetchJSON(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`Received from API: ${text}`);
    return { error: e };
  }
}

const fetchAPI = (path: string) => fetchJSON(path.startsWith("user") ? user(path) : story(path));

/** Remembers each answer (and each request in flight) for a minute. */
function kept<A extends unknown[], T>(load: (...args: A) => Promise<T>, ms = 60_000) {
  const answers = new Map<string, { at: number; value: Promise<T> }>();
  return (...args: A): Promise<T> => {
    const key = JSON.stringify(args);
    const hit = answers.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.value;
    const value = load(...args);
    answers.set(key, { at: Date.now(), value });
    value.catch(() => answers.delete(key));
    return value;
  };
}

export const hn = {
  getStories: kept(async (type: StoryTypes, page: number): Promise<StoryDefinition[]> => {
    const storyType = mapStories[type];
    if (!storyType) return [];
    return fetchAPI(`${storyType}?page=${page}`);
  }),
  getStory: kept(async (id: string): Promise<StoryDefinition> => {
    if (id === CACHED_STORY_ID) return fetchJSON(`${import.meta.env.BASE_URL}story-${CACHED_STORY_ID}.json`);
    return fetchAPI(`item/${id}`);
  }),
  getUser: kept(async (id: string): Promise<UserDefinition> => fetchAPI(`user/${id}`))
};

export type HN = typeof hn;
