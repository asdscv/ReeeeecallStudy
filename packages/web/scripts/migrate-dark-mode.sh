#!/bin/bash
# Dark mode migration: replace hardcoded Tailwind colors with semantic tokens
# Run from packages/web directory

DIR="src"

# Helper function for sed replacement across all tsx files
replace() {
  local from="$1"
  local to="$2"
  find "$DIR" -name "*.tsx" -exec sed -i '' "s/$from/$to/g" {} +
}

echo "=== Phase 1: Remove existing dark: pairs that will be handled by variables ==="
# Remove dark: overrides that become redundant with semantic tokens
# Pattern: "bg-white dark:bg-gray-800" → will become "bg-card"
# Pattern: "text-gray-900 dark:text-gray-100" → will become "text-foreground"
# These are handled below in the main replacements

echo "=== Phase 2: Background colors ==="
# bg-white → bg-card (most are in card contexts)
replace 'bg-white dark:bg-gray-900' 'bg-card'
replace 'bg-white dark:bg-gray-800' 'bg-card'
replace 'bg-white dark:bg-slate-800' 'bg-card'
replace 'bg-white dark:bg-gray-700' 'bg-card'
replace 'bg-white' 'bg-card'

# bg-gray-50 variants
replace 'bg-gray-50 dark:bg-gray-800' 'bg-muted'
replace 'bg-gray-50 dark:bg-gray-700\/50' 'bg-muted'
replace 'bg-gray-50 dark:bg-gray-900' 'bg-muted'
replace 'bg-gray-50' 'bg-muted'

# bg-gray-100
replace 'bg-gray-100 dark:bg-gray-700' 'bg-accent'
replace 'bg-gray-100 dark:bg-gray-800' 'bg-accent'
replace 'bg-gray-100' 'bg-accent'

# bg-gray-200
replace 'bg-gray-200 dark:bg-gray-600' 'bg-accent'
replace 'bg-gray-200' 'bg-accent'

# bg-gray-800, bg-gray-900 (used standalone in dark contexts like nav)
replace 'bg-gray-900' 'bg-foreground'
replace 'bg-gray-800' 'bg-foreground'

echo "=== Phase 3: Text colors ==="
# text-gray-900
replace 'text-gray-900 dark:text-gray-100' 'text-foreground'
replace 'text-gray-900 dark:text-white' 'text-foreground'
replace 'text-gray-900 dark:text-gray-50' 'text-foreground'
replace 'text-gray-900' 'text-foreground'

# text-gray-800
replace 'text-gray-800 dark:text-gray-200' 'text-foreground'
replace 'text-gray-800 dark:text-gray-100' 'text-foreground'
replace 'text-gray-800' 'text-foreground'

# text-gray-700
replace 'text-gray-700 dark:text-gray-300' 'text-foreground'
replace 'text-gray-700 dark:text-gray-200' 'text-foreground'
replace 'text-gray-700' 'text-foreground'

# text-gray-600
replace 'text-gray-600 dark:text-gray-400' 'text-muted-foreground'
replace 'text-gray-600 dark:text-gray-300' 'text-muted-foreground'
replace 'text-gray-600' 'text-muted-foreground'

# text-gray-500
replace 'text-gray-500 dark:text-gray-400' 'text-muted-foreground'
replace 'text-gray-500 dark:text-gray-300' 'text-muted-foreground'
replace 'text-gray-500' 'text-muted-foreground'

# text-gray-400
replace 'text-gray-400 dark:text-gray-500' 'text-content-tertiary'
replace 'text-gray-400' 'text-content-tertiary'

# text-gray-300
replace 'text-gray-300' 'text-content-tertiary'

# text-white (on dark backgrounds / buttons)
# Skip - context dependent, keep as is

echo "=== Phase 4: Border colors ==="
replace 'border-gray-200 dark:border-gray-700' 'border-border'
replace 'border-gray-200 dark:border-gray-600' 'border-border'
replace 'border-gray-200' 'border-border'
replace 'border-gray-100 dark:border-gray-700' 'border-border'
replace 'border-gray-100' 'border-border'
replace 'border-gray-300 dark:border-gray-600' 'border-border'
replace 'border-gray-300' 'border-border'
replace 'divide-gray-200' 'divide-border'
replace 'divide-gray-100' 'divide-border'

echo "=== Phase 5: Blue → brand ==="
replace 'bg-blue-600' 'bg-brand'
replace 'bg-blue-700' 'bg-brand'
replace 'bg-blue-500' 'bg-brand'
replace 'bg-blue-400' 'bg-brand'
replace 'bg-blue-50' 'bg-brand\/10'
replace 'bg-blue-100' 'bg-brand\/15'
replace 'text-blue-800' 'text-brand'
replace 'text-blue-700' 'text-brand'
replace 'text-blue-600' 'text-brand'
replace 'text-blue-500' 'text-brand'
replace 'text-blue-400' 'text-brand\/70'
replace 'border-blue-600' 'border-brand'
replace 'border-blue-500' 'border-brand'
replace 'border-blue-400' 'border-brand'
replace 'border-blue-300' 'border-brand\/30'
replace 'border-blue-200' 'border-brand\/30'
replace 'ring-blue-500' 'ring-brand'
replace 'ring-blue-400' 'ring-brand'
replace 'ring-blue-300' 'ring-brand\/50'

echo "=== Phase 6: Hover states ==="
replace 'hover:bg-gray-50' 'hover:bg-muted'
replace 'hover:bg-gray-100' 'hover:bg-accent'
replace 'hover:bg-gray-200' 'hover:bg-accent'
replace 'hover:bg-blue-700' 'hover:bg-brand\/90'
replace 'hover:bg-blue-600' 'hover:bg-brand\/90'
replace 'hover:bg-blue-800' 'hover:bg-brand\/80'
replace 'hover:bg-blue-50' 'hover:bg-brand\/10'
replace 'hover:bg-blue-100' 'hover:bg-brand\/15'
replace 'hover:text-gray-900' 'hover:text-foreground'
replace 'hover:text-gray-800' 'hover:text-foreground'
replace 'hover:text-gray-700' 'hover:text-foreground'
replace 'hover:text-gray-600' 'hover:text-muted-foreground'
replace 'hover:text-blue-800' 'hover:text-brand'
replace 'hover:text-blue-700' 'hover:text-brand'
replace 'hover:text-blue-600' 'hover:text-brand'
replace 'hover:border-gray-300' 'hover:border-border'
replace 'hover:border-gray-400' 'hover:border-border'
replace 'hover:border-blue-500' 'hover:border-brand'

echo "=== Phase 7: Focus states ==="
replace 'focus:border-blue-500' 'focus:border-brand'
replace 'focus:border-blue-400' 'focus:border-brand'
replace 'focus:ring-blue-500' 'focus:ring-brand'
replace 'focus:ring-blue-400' 'focus:ring-brand'
replace 'focus:ring-blue-300' 'focus:ring-brand\/50'
replace 'focus:ring-blue-200' 'focus:ring-brand\/30'
replace 'focus-within:ring-blue-500' 'focus-within:ring-brand'
replace 'focus-within:border-blue-500' 'focus-within:border-brand'

echo "=== Phase 8: Red → destructive ==="
replace 'bg-red-600' 'bg-destructive'
replace 'bg-red-700' 'bg-destructive'
replace 'bg-red-500' 'bg-destructive'
replace 'bg-red-50' 'bg-destructive\/10'
replace 'bg-red-100' 'bg-destructive\/15'
replace 'text-red-800' 'text-destructive'
replace 'text-red-700' 'text-destructive'
replace 'text-red-600' 'text-destructive'
replace 'text-red-500' 'text-destructive'
replace 'text-red-400' 'text-destructive\/70'
replace 'border-red-500' 'border-destructive'
replace 'border-red-400' 'border-destructive\/50'
replace 'border-red-300' 'border-destructive\/30'
replace 'border-red-200' 'border-destructive\/30'
replace 'hover:bg-red-700' 'hover:bg-destructive\/90'
replace 'hover:bg-red-600' 'hover:bg-destructive\/90'
replace 'hover:bg-red-50' 'hover:bg-destructive\/10'
replace 'hover:text-red-700' 'hover:text-destructive'
replace 'hover:text-red-600' 'hover:text-destructive'
replace 'ring-red-500' 'ring-destructive'
replace 'ring-red-400' 'ring-destructive\/50'

echo "=== Phase 9: Green → success ==="
replace 'bg-green-600' 'bg-success'
replace 'bg-green-500' 'bg-success'
replace 'bg-green-400' 'bg-success'
replace 'bg-green-50' 'bg-success\/10'
replace 'bg-green-100' 'bg-success\/15'
replace 'text-green-800' 'text-success'
replace 'text-green-700' 'text-success'
replace 'text-green-600' 'text-success'
replace 'text-green-500' 'text-success'
replace 'text-green-400' 'text-success\/70'
replace 'border-green-500' 'border-success'
replace 'border-green-400' 'border-success\/50'
replace 'border-green-300' 'border-success\/30'
replace 'border-green-200' 'border-success\/30'
replace 'hover:bg-green-700' 'hover:bg-success\/90'
replace 'hover:bg-green-600' 'hover:bg-success\/90'
replace 'ring-green-500' 'ring-success'

echo "=== Phase 10: Yellow/Amber → warning ==="
replace 'bg-yellow-500' 'bg-warning'
replace 'bg-yellow-400' 'bg-warning'
replace 'bg-yellow-50' 'bg-warning\/10'
replace 'bg-yellow-100' 'bg-warning\/15'
replace 'bg-amber-500' 'bg-warning'
replace 'bg-amber-50' 'bg-warning\/10'
replace 'bg-amber-100' 'bg-warning\/15'
replace 'text-yellow-800' 'text-warning'
replace 'text-yellow-700' 'text-warning'
replace 'text-yellow-600' 'text-warning'
replace 'text-yellow-500' 'text-warning'
replace 'text-amber-800' 'text-warning'
replace 'text-amber-700' 'text-warning'
replace 'text-amber-600' 'text-warning'
replace 'text-amber-500' 'text-warning'
replace 'border-yellow-500' 'border-warning'
replace 'border-yellow-400' 'border-warning'
replace 'border-yellow-300' 'border-warning\/50'
replace 'border-yellow-200' 'border-warning\/30'
replace 'border-amber-300' 'border-warning\/50'
replace 'border-amber-200' 'border-warning\/30'

echo "=== Phase 11: Cleanup leftover dark: overrides for neutrals ==="
# Remove standalone dark: overrides that are now handled by variables
# e.g., "dark:bg-gray-800" "dark:text-gray-100" "dark:border-gray-700"
replace ' dark:bg-gray-900' ''
replace ' dark:bg-gray-800' ''
replace ' dark:bg-gray-700' ''
replace ' dark:bg-gray-600' ''
replace ' dark:text-white' ''
replace ' dark:text-gray-100' ''
replace ' dark:text-gray-200' ''
replace ' dark:text-gray-300' ''
replace ' dark:text-gray-400' ''
replace ' dark:text-gray-500' ''
replace ' dark:border-gray-700' ''
replace ' dark:border-gray-600' ''
replace ' dark:border-gray-500' ''
replace ' dark:divide-gray-700' ''
replace ' dark:divide-gray-600' ''
replace ' dark:hover:bg-gray-700' ''
replace ' dark:hover:bg-gray-600' ''
replace ' dark:hover:bg-gray-800' ''
replace ' dark:hover:text-white' ''
replace ' dark:hover:text-gray-200' ''
replace ' dark:shadow-gray-900' ''

echo "=== Done! ==="
echo "Replacements complete. Run Playwright to verify."
