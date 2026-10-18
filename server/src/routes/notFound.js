/**
 * @param {Request} request
 */
export function notFound(request) {
  return Response.json(
    {
      error: 'not_found',
      message: 'No route matches this URL.',
      method: request.method,
      path: new URL(request.url).pathname,
    },
    {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  )
}
