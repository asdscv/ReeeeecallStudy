/**
 * ═══════════════════════════════════════════════════════
 * template-renderer.ts — Custom HTML template rendering
 *
 * 사용자가 작성한 HTML 템플릿에서 {{필드이름}} 플레이스홀더를
 * 실제 카드 필드 값으로 치환한다.
 *
 * 보안:
 *   - 템플릿 HTML 자체는 사용자가 직접 작성 → 그대로 유지
 *   - 필드 값(카드 데이터)은 HTML escape 처리 → XSS 방지
 * ═══════════════════════════════════════════════════════
 */

/**
 * Escape HTML special characters in a string.
 * Used to sanitize field values before inserting into HTML template.
 */
export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Render a custom HTML template by replacing {{fieldName}} placeholders
 * with escaped field values.
 *
 * @param html      — User-authored HTML template (e.g., `<h1>{{앞면}}</h1>`)
 * @param values    — Card field values keyed by field.key (e.g., { field_1: 'hello' })
 * @param fields    — Template field definitions mapping key → name
 * @returns         — Rendered HTML string with placeholders replaced
 *
 * Unknown placeholders (not matching any field name) are left as-is.
 */
export function renderCustomHTML(
  html: string,
  values: Record<string, string>,
  fields: { key: string; name: string }[],
): string {
  let result = html
  for (const field of fields) {
    const placeholder = `{{${field.name}}}`
    const value = escapeHTML(values[field.key] ?? '')
    result = result.replaceAll(placeholder, value)
  }
  return result
}
