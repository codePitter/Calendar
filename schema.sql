-- ============================================================
-- Agenda 2026 — Supabase Schema
-- Pegá esto en el SQL Editor de tu proyecto Supabase
-- ============================================================

-- Tabla de eventos regulares
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_key     TEXT NOT NULL,
  title        TEXT NOT NULL,
  start_time   TEXT,
  end_time     TEXT,
  description  TEXT    DEFAULT '',
  color        TEXT    DEFAULT '#4f46e5',
  image_url    TEXT,
  important    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_user_date ON events (user_id, date_key);

-- Tabla de eventos recurrentes
CREATE TABLE IF NOT EXISTS recurring_events (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  start_time      TEXT,
  end_time        TEXT,
  description     TEXT DEFAULT '',
  color           TEXT DEFAULT '#4f46e5',
  image_url       TEXT,
  important       BOOLEAN DEFAULT FALSE,
  recurrence      TEXT NOT NULL,
  original_date   TEXT NOT NULL,
  end_recurrence  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recurring_user ON recurring_events (user_id);

-- Preferencias del usuario
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  end_hour   INTEGER DEFAULT 24,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings   ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo ve y modifica sus propios datos
CREATE POLICY "events_own" ON events
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "recurring_own" ON recurring_events
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_own" ON user_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
