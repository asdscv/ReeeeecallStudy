-- Add zh (Chinese Simplified) and ja (Japanese) locale support

-- 1. Update contents.locale CHECK constraint
ALTER TABLE contents DROP CONSTRAINT IF EXISTS contents_locale_check;
ALTER TABLE contents ADD CONSTRAINT contents_locale_check CHECK (locale IN ('en', 'ko', 'zh', 'ja'));

-- 2. Add CHECK constraint on profiles.locale (none existed before)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_locale_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_locale_check CHECK (locale IN ('en', 'ko', 'zh', 'ja'));
