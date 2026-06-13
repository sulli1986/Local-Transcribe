/** Resolve a meeting-relative asset path to the vault:// protocol URL. */
export function assetUrl(meetingId: string, rel: string): string {
  const parts = rel.split('/').map(encodeURIComponent).join('/')
  return `vault://files/${encodeURIComponent(meetingId)}/${parts}`
}
