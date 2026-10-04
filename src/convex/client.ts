import { ConvexReactClient } from "convex/react";
import { CONVEX_URL } from "../config/convexConfig";

export const convex = new ConvexReactClient(CONVEX_URL, {
  unsavedChangesWarning: false,
  skipConvexDeploymentUrlCheck: true,
});
