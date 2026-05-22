// Resolve a project-scoped file path served by the studio. The default backend
// route is GET /api/projects/:id/files/:path — the `path` is interpreted as a
// relative path under the project root.
//
// `baseUrl` lets embedders point file fetches at a different host/route shape
// (e.g. the public viewer hits `https://seeflow.dev/api/flows/:id/files/:path`,
// which is the same `/<id>/files/<path>` suffix under a different prefix).
// Trailing slashes on `baseUrl` are stripped so callers can pass either form.
//
// `encodeURI` is used (not `encodeURIComponent`) so the slash characters that
// separate directory segments survive: imageNode + htmlNode payloads commonly
// reference paths like `assets/foo.png` or `blocks/abc.html`.
export function fileUrl(projectId: string, path: string, baseUrl?: string): string {
  const prefix = baseUrl !== undefined ? baseUrl.replace(/\/+$/, '') : '/api/projects';
  return `${prefix}/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`;
}
