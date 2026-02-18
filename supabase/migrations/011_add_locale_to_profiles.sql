-- Add locale column to profiles table for i18n support
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';
