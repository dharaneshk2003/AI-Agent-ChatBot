import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Local, key-free replacements for the retired IBM wxflows tools.
 * These use public APIs that do not require an account or API key.
 */

const USER_AGENT = "LLM-Tool local demo (https://localhost:3000)";

/**
 * Public APIs rate-limit quickly. Retry briefly, then return a graceful
 * message instead of throwing, which would make the model loop on "fix it".
 */
async function fetchJson(url: URL): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) return null;
    await new Promise((resolve) =>
      setTimeout(resolve, 500 * (attempt + 1))
    );
  }
  return null;
}

const UNAVAILABLE = (name: string) =>
  `${name} is temporarily unavailable (rate limited or offline). Answer using any information you already have instead of calling this tool again.`;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export const wikipediaSearchTool = tool(
  async ({ query, limit }) => {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", query);
    url.searchParams.set("srlimit", String(Math.min(Math.max(limit, 1), 10)));
    url.searchParams.set("format", "json");

    const json = await fetchJson(url);
    if (!json) return UNAVAILABLE("Wikipedia search");

    const data = json as {
      query?: {
        search?: Array<{ title: string; snippet: string }>;
      };
    };

    const results = (data.query?.search ?? []).map((result) => ({
      title: result.title,
      snippet: stripHtml(result.snippet),
    }));

    return JSON.stringify(results, null, 2);
  },
  {
    name: "wikipedia_search",
    description:
      "Search Wikipedia for articles. Returns titles and short snippets. Use this to discover the exact article title before calling wikipedia_article.",
    schema: z.object({
      query: z.string().min(1).describe("Search terms"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum number of results"),
    }),
  }
);

export const wikipediaArticleTool = tool(
  async ({ title, maxChars }) => {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("prop", "extracts");
    url.searchParams.set("explaintext", "1");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("titles", title);
    url.searchParams.set("format", "json");

    const json = await fetchJson(url);
    if (!json) return UNAVAILABLE("Wikipedia article lookup");

    const data = json as {
      query?: {
        pages?: Record<string, { title?: string; extract?: string; missing?: boolean }>;
      };
    };

    const page = Object.values(data.query?.pages ?? {})[0];
    if (!page || page.missing || !page.extract) {
      return `No Wikipedia article found for "${title}".`;
    }

    const extract = page.extract.slice(0, Math.min(Math.max(maxChars, 500), 12000));
    return JSON.stringify(
      { title: page.title, extract, truncated: page.extract.length > extract.length },
      null,
      2
    );
  },
  {
    name: "wikipedia_article",
    description:
      "Get the plain-text extract of a Wikipedia article by its exact title. Use wikipedia_search first if you are unsure of the title.",
    schema: z.object({
      title: z.string().min(1).describe("Exact Wikipedia article title"),
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(12000)
        .default(6000)
        .describe("Maximum characters to return"),
    }),
  }
);

export const googleBooksTool = tool(
  async ({ query, maxResults }) => {
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(Math.min(Math.max(maxResults, 1), 10)));

    const json = await fetchJson(url);
    if (!json) return UNAVAILABLE("Google Books");

    const data = json as {
      totalItems?: number;
      items?: Array<{
        id?: string;
        volumeInfo?: {
          title?: string;
          authors?: string[];
          publishedDate?: string;
          description?: string;
          infoLink?: string;
        };
      }>;
    };

    const books = (data.items ?? []).map((item) => {
      const info = item.volumeInfo ?? {};
      return {
        id: item.id,
        title: info.title,
        authors: info.authors ?? [],
        publishedDate: info.publishedDate,
        description: info.description ? stripHtml(info.description).slice(0, 1200) : undefined,
        link: info.infoLink,
      };
    });

    return JSON.stringify({ totalItems: data.totalItems ?? books.length, books }, null, 2);
  },
  {
    name: "google_books_search",
    description:
      "Search Google Books for books by title, author, or subject. Returns titles, authors, publication dates, descriptions, and links. No API key required.",
    schema: z.object({
      query: z.string().min(1).describe("Book search terms"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum number of books to return"),
    }),
  }
);

export const localTools = [wikipediaSearchTool, wikipediaArticleTool, googleBooksTool];
