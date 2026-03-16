import { createClient } from '@supabase/supabase-js'
import { initSupabase } from '@reeeeecall/shared/lib/supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Also initialize the shared supabase singleton so shared stores work
initSupabase(supabaseUrl, supabaseAnonKey)
