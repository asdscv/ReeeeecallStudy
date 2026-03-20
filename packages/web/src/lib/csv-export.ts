/**
 * CSV Export Utility
 *
 * Reusable helpers for exporting data as CSV files from the admin dashboard.
 */

/**
 * Escape a single CSV cell value.
 * - Null/undefined → empty string
 * - Objects/arrays → JSON stringified
 * - Strings containing commas, quotes, or newlines → wrapped in double-quotes
 * - Double-quotes inside values → escaped as ""
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'object') {
    return escapeCsvValue(JSON.stringify(value));
  }

  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of objects to a CSV string and trigger a browser download.
 *
 * @param filename - Download filename (`.csv` is appended automatically)
 * @param rows     - Data rows
 * @param columns  - Optional column definitions. When omitted the keys of the
 *                   first row are used as both key and header label.
 */
export function exportToCsv(
  filename: string,
  rows: Record<string, unknown>[],
  columns?: { key: string; label: string }[],
): void {
  if (rows.length === 0) return;

  const cols =
    columns ??
    Object.keys(rows[0]).map((key) => ({ key, label: key }));

  const headerLine = cols.map((c) => escapeCsvValue(c.label)).join(',');

  const dataLines = rows.map((row) =>
    cols.map((c) => escapeCsvValue(row[c.key])).join(','),
  );

  const csvContent = [headerLine, ...dataLines].join('\r\n');

  // UTF-8 BOM so Excel opens the file with correct encoding
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Format an ISO-8601 date string for CSV export.
 *
 * @returns `YYYY-MM-DD HH:mm:ss` in local time, or the original string if
 *          parsing fails.
 */
export function formatCsvDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Pre-built export configurations for each admin section.
 */
export const EXPORT_CONFIGS = {
  users: {
    filename: 'users-export',
    columns: [
      { key: 'display_name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'is_official', label: 'Official' },
      { key: 'created_at', label: 'Joined' },
    ],
  },
  auditLogs: {
    filename: 'audit-logs-export',
    columns: [
      { key: 'created_at', label: 'Time' },
      { key: 'admin_display_name', label: 'Admin' },
      { key: 'action', label: 'Action' },
      { key: 'target_type', label: 'Target Type' },
      { key: 'target_id', label: 'Target ID' },
      { key: 'details', label: 'Details' },
    ],
  },
  studyActivity: {
    filename: 'study-activity-export',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'sessions', label: 'Sessions' },
      { key: 'cards', label: 'Cards' },
      { key: 'total_duration_ms', label: 'Duration (ms)' },
    ],
  },
  marketListings: {
    filename: 'market-listings-export',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'category', label: 'Category' },
      { key: 'share_mode', label: 'Share Mode' },
      { key: 'card_count', label: 'Cards' },
      { key: 'acquire_count', label: 'Acquires' },
      { key: 'is_active', label: 'Active' },
    ],
  },
} as const;
