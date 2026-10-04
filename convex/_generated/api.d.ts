/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as calls from "../calls.js";
import type * as conversations from "../conversations.js";
import type * as files from "../files.js";
import type * as lib_helpers from "../lib/helpers.js";
import type * as messages from "../messages.js";
import type * as push from "../push.js";
import type * as reactions from "../reactions.js";
import type * as updates from "../updates.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  calls: typeof calls;
  conversations: typeof conversations;
  files: typeof files;
  "lib/helpers": typeof lib_helpers;
  messages: typeof messages;
  push: typeof push;
  reactions: typeof reactions;
  updates: typeof updates;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
