/** Redirect target that shows `message` as a toast on arrival (see components/flash). */
export function withDone(path: string, message: string) {
  return `${path}${path.includes('?') ? '&' : '?'}done=${encodeURIComponent(message)}`;
}
