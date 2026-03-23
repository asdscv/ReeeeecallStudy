export function ContentDetailSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-pulse">
      {/* Title */}
      <div className="h-10 bg-accent rounded w-4/5 mb-4" />
      <div className="h-6 bg-accent rounded w-3/5 mb-6" />
      <div className="h-4 bg-accent rounded w-1/4 mb-12" />

      {/* Paragraphs */}
      <div className="space-y-4 mb-10">
        <div className="h-4 bg-accent rounded w-full" />
        <div className="h-4 bg-accent rounded w-full" />
        <div className="h-4 bg-accent rounded w-3/4" />
      </div>

      {/* Blockquote */}
      <div className="border-l-4 border-border pl-6 py-2 mb-10">
        <div className="h-5 bg-accent rounded w-4/5" />
      </div>

      {/* Stats */}
      <div className="bg-accent rounded-2xl p-8 mb-10">
        <div className="grid grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="text-center space-y-2">
              <div className="h-8 bg-accent rounded w-16 mx-auto" />
              <div className="h-3 bg-accent rounded w-20 mx-auto" />
            </div>
          ))}
        </div>
      </div>

      {/* Heading */}
      <div className="w-12 h-1 bg-accent rounded mb-3" />
      <div className="h-7 bg-accent rounded w-2/5 mb-6" />

      {/* More paragraphs */}
      <div className="space-y-4">
        <div className="h-4 bg-accent rounded w-full" />
        <div className="h-4 bg-accent rounded w-full" />
        <div className="h-4 bg-accent rounded w-2/3" />
      </div>
    </div>
  )
}
