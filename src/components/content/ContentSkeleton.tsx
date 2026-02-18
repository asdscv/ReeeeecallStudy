const heights = [280, 320, 350, 380, 400, 420]

export function ContentSkeleton() {
  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="break-inside-avoid mb-5">
          <div
            className="rounded-2xl overflow-hidden bg-gradient-to-br from-gray-200 to-gray-300 animate-pulse"
            style={{ height: heights[i % heights.length] }}
          >
            <div className="flex flex-col justify-end h-full p-5">
              <div className="h-6 bg-white/20 rounded w-3/4 mb-2" />
              <div className="h-6 bg-white/20 rounded w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
