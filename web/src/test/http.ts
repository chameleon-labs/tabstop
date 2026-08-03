/**
 * Kept apart from `render.tsx` so a spec about the API client does not pull the
 * router, React and every screen into its module graph to build one response.
 */

/** A JSON response, shaped the way the server shapes one. */
export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
