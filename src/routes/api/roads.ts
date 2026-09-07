import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/roads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleRoads } = await import("@/lib/rail/roads.server");
        return handleRoads(request);
      },
    },
  },
});
