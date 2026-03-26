// RSS / Atom / JSON feed handler — extracted from worker.js handleRSSFeed
import { SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE } from './constants.js'
import { escapeHtml, getSupabaseRestUrl, getSupabaseAnonKey } from './helpers.js'

export async function handleRSSFeed(env, format = 'rss', lang = 'en') {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)
  if (!anonKey) return new Response('Feed not configured', { status: 500 })

  const res = await fetch(
    `${restUrl}/contents?is_published=eq.true&locale=eq.${lang}&select=slug,title,subtitle,meta_description,published_at,updated_at,tags,author_name,thumbnail_url,reading_time_minutes&order=published_at.desc&limit=50`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  const articles = (await res.json()) || []

  if (format === 'json') {
    // JSON Feed (https://jsonfeed.org/)
    const jsonFeed = {
      version: 'https://jsonfeed.org/version/1.1',
      title: `${BRAND_NAME} — Learning Insights`,
      home_page_url: `${SITE_URL}/insight`,
      feed_url: `${SITE_URL}/feed.json`,
      description: 'Science-backed learning strategies, spaced repetition tips, and study techniques.',
      icon: `${SITE_URL}/favicon.png`,
      favicon: `${SITE_URL}/favicon.png`,
      language: 'en',
      authors: [{ name: BRAND_NAME, url: SITE_URL }],
      items: articles.map((a) => ({
        id: `${SITE_URL}/insight/${a.slug}`,
        url: `${SITE_URL}/insight/${a.slug}`,
        title: a.title,
        summary: a.meta_description || a.subtitle || '',
        date_published: a.published_at,
        date_modified: a.updated_at,
        authors: [{ name: a.author_name || BRAND_NAME }],
        tags: a.tags || [],
        image: a.thumbnail_url || DEFAULT_OG_IMAGE,
      })),
    }
    return new Response(JSON.stringify(jsonFeed, null, 2), {
      headers: {
        'Content-Type': 'application/feed+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    })
  }

  if (format === 'atom') {
    const updated = articles[0]?.updated_at || new Date().toISOString()
    const entries = articles.map((a) => {
      const pubDate = a.published_at || new Date().toISOString()
      return `  <entry>
    <title>${escapeHtml(a.title)}</title>
    <link href="${SITE_URL}/insight/${a.slug}" rel="alternate" type="text/html"/>
    <id>${SITE_URL}/insight/${a.slug}</id>
    <published>${pubDate}</published>
    <updated>${a.updated_at || pubDate}</updated>
    <author><name>${escapeHtml(a.author_name || BRAND_NAME)}</name></author>
    <summary type="text">${escapeHtml(a.meta_description || a.subtitle || '')}</summary>
${(a.tags || []).map((t) => `    <category term="${escapeHtml(t)}"/>`).join('\n')}
  </entry>`
    }).join('\n')

    const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${BRAND_NAME} — Learning Insights</title>
  <subtitle>Science-backed learning strategies, spaced repetition tips, and study techniques.</subtitle>
  <link href="${SITE_URL}/feed.atom" rel="self" type="application/atom+xml"/>
  <link href="${SITE_URL}/insight" rel="alternate" type="text/html"/>
  <id>${SITE_URL}/insight</id>
  <updated>${updated}</updated>
  <author><name>${BRAND_NAME}</name></author>
  <icon>${SITE_URL}/favicon.png</icon>
  <logo>${DEFAULT_OG_IMAGE}</logo>
  <rights>Copyright ${new Date().getFullYear()} ${BRAND_NAME}</rights>
  <generator>ReeeeecallStudy Content Pipeline</generator>
${entries}
</feed>`

    return new Response(atom, {
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    })
  }

  // RSS 2.0
  const items = articles.map((a) => {
    const pubDate = a.published_at ? new Date(a.published_at).toUTCString() : ''
    return `    <item>
      <title>${escapeHtml(a.title)}</title>
      <link>${SITE_URL}/insight/${a.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/insight/${a.slug}</guid>
      <description>${escapeHtml(a.meta_description || a.subtitle || '')}</description>
      <pubDate>${pubDate}</pubDate>
      <author>admin@reeeeecallstudy.xyz (${escapeHtml(a.author_name || BRAND_NAME)})</author>
${(a.tags || []).map((t) => `      <category>${escapeHtml(t)}</category>`).join('\n')}
${a.thumbnail_url ? `      <enclosure url="${escapeHtml(a.thumbnail_url)}" type="image/jpeg" length="0"/>` : ''}
      <source url="${SITE_URL}/feed.xml">${BRAND_NAME} Learning Insights</source>
    </item>`
  }).join('\n')

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${BRAND_NAME} — Learning Insights</title>
    <link>${SITE_URL}/insight</link>
    <description>Science-backed learning strategies, spaced repetition tips, and study techniques. Free articles to help you study smarter and remember longer.</description>
    <language>en</language>
    <lastBuildDate>${articles[0]?.published_at ? new Date(articles[0].published_at).toUTCString() : new Date().toUTCString()}</lastBuildDate>
    <managingEditor>admin@reeeeecallstudy.xyz (${BRAND_NAME})</managingEditor>
    <webMaster>admin@reeeeecallstudy.xyz (${BRAND_NAME})</webMaster>
    <copyright>Copyright ${new Date().getFullYear()} ${BRAND_NAME}</copyright>
    <category>Education</category>
    <category>Learning</category>
    <category>Study Tips</category>
    <generator>ReeeeecallStudy Content Pipeline</generator>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <ttl>60</ttl>
    <image>
      <url>${DEFAULT_OG_IMAGE}</url>
      <title>${BRAND_NAME}</title>
      <link>${SITE_URL}</link>
      <width>144</width>
      <height>144</height>
    </image>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
