import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

const supabaseUrl = `https://${projectId}.supabase.co`;

export const supabase = createSupabaseClient(supabaseUrl, publicAnonKey);

export { projectId, publicAnonKey, supabaseUrl };
