/**
 * @param {string} text
 * @param {{ writeText?: (value: string) => Promise<void> } | null | undefined} clipboard
 */
export async function copyTextToClipboard(text, clipboard) {
  const value = String(text ?? '')
  if (!value) {
    return { ok: false, error: 'empty', message: 'Nothing to copy.' }
  }
  const api = clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : null)
  if (!api?.writeText) {
    return { ok: false, error: 'unsupported', message: 'Copy is not supported in this browser.' }
  }
  try {
    await api.writeText(value)
    return { ok: true, message: 'Message copied to clipboard.' }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: 'failed', message: detail || 'Could not copy to clipboard.' }
  }
}
