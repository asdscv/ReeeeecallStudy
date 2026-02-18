// Supabase REST API client for content operations

import { getSupabaseConfig } from './config.js'
import { info, error } from './logger.js'

export function createSupabaseClient(env) {
  const config = getSupabaseConfig(env)
  const restUrl = `${config.url}/rest/v1`

  async function getRecentContent(limit = 100) {
    const url = `${restUrl}/contents?select=id,slug,title,tags,locale&order=created_at.desc&limit=${limit}`
    const res = await fetch(url, {
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      error('Failed to fetch recent content', { status: res.status, body })
      return []
    }

    return res.json()
  }

  async function insertContent(article) {
    const url = `${restUrl}/contents`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(article),
    })

    if (!res.ok) {
      const body = await res.text()
      error('Failed to insert content', { status: res.status, body })
      throw new Error(`Supabase insert failed: ${res.status} - ${body}`)
    }

    const data = await res.json()
    info('Content inserted', { id: data[0]?.id, slug: article.slug, locale: article.locale })
    return data[0]
  }

  async function uploadImage(slug, imageBuffer, contentType = 'image/jpeg') {
    const storageUrl = `${config.url}/storage/v1/object/content-images/${slug}.jpg`
    const res = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: imageBuffer,
    })

    if (!res.ok) {
      const body = await res.text()
      error('Failed to upload image', { status: res.status, body })
      throw new Error(`Storage upload failed: ${res.status}`)
    }

    const publicUrl = `${config.url}/storage/v1/object/public/content-images/${slug}.jpg`
    info('Image uploaded', { publicUrl })
    return publicUrl
  }

  return { getRecentContent, insertContent, uploadImage }
}
