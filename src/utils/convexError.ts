import { ConvexError } from "convex/values";

export function convexErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data = err.data;
    if (typeof data === "string" && data.length > 0) {
      return data;
    }
  }
  if (err instanceof Error && err.message) {
    const match = err.message.match(/Uncaught (?:Convex)?Error: ([^\n]+)/);
    if (match && match[1]) {
      return match[1];
    }
    if (err.message.length > 0 && err.message.length < 220) {
      return err.message;
    }
  }
  return fallback;
}
