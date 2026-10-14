// The library API over localStorage, for local mode and for the tests: the
// same interface as the online one, built from three small parts that share a
// context (whose library, where stored, and what to ask the rest of the app).
import { createLocalContext } from "./localContext";
import { createLocalLinksApi } from "./localLinksApi";
import { createLocalSharingApi } from "./localSharingApi";
import { createLocalViewsApi } from "./localViewsApi";
import { createLocalWordsApi } from "./localWordsApi";

export function createLocalLibraryApi(options) {
  const ctx = createLocalContext(options);
  return { mode: "local", ...createLocalViewsApi(ctx), ...createLocalWordsApi(ctx), ...createLocalSharingApi(ctx), ...createLocalLinksApi(ctx) };
}
