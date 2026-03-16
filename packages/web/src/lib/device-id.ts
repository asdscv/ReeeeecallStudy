// ============================================================
// Device ID — persistent unique identifier per browser/device
// ============================================================

const STORAGE_KEY = 'reeeeecall_device_id'

function generateId(): string {
  // crypto.randomUUID is available in all modern browsers
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = generateId()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    // Private browsing or storage blocked — use session-scoped ID
    return generateId()
  }
}

export function getDeviceName(): string {
  try {
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS Device'
    if (/Android/.test(ua)) return 'Android Device'
    if (/Mac/.test(ua)) return 'Mac'
    if (/Windows/.test(ua)) return 'Windows PC'
    if (/Linux/.test(ua)) return 'Linux'
    return 'Unknown Device'
  } catch {
    return 'Unknown Device'
  }
}
