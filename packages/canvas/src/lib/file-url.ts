// Resolve a project-scoped file path served by the studio. The backend route
// is GET /api/projects/:id/files/:path — the `path` is interpreted as a
// relative path under `<project>/.seeflow/`.
//
// `encodeURI` is used (not `encodeURIComponent`) so the slash characters that
// separate directory segments survive: imageNode + htmlNode payloads commonly
// reference paths like `assets/foo.png` or `blocks/abc.html`.
export function fileUrl(projectId: string, path: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`;
}
