/**
 * Trigger a file download in the browser.
 * Handles CSV BOM injection for Excel compatibility.
 */
export function downloadFile(content: string, mimeType: string, fileName: string): void {
  const bom = mimeType.startsWith('text/csv') ? '\uFEFF' : ''
  const blob = new Blob([bom + content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  // Defer cleanup so the browser can finish initiating the download (Firefox, large files)
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}
