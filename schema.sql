-- Voer dit uit in de Supabase SQL Editor
-- Veilig om te draaien — migreert bestaande tabellen of maakt nieuwe aan.

-- Enable pgcrypto voor wachtwoord hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==================== MIGRATIE (bestaande profiles naar eigen auth) ====================
DO $$ BEGIN
  -- Voeg password_hash kolom toe als die nog niet bestaat
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
  -- Drop FK naar auth.users
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
  -- Zet DEFAULT op id (voor nieuwe inserts)
  ALTER TABLE profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN undefined_table THEN null; END $$;

-- ==================== GAMES ====================
CREATE TABLE IF NOT EXISTS games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished')),
  host_id UUID,
  current_question INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PLAYERS
CREATE TABLE IF NOT EXISTS players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  score INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ANSWERS
CREATE TABLE IF NOT EXISTS answers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  question_index INT NOT NULL,
  answer TEXT NOT NULL,
  correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- QUESTIONS
CREATE TABLE IF NOT EXISTS questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  question_index INT NOT NULL,
  type VARCHAR(20) DEFAULT 'multiple' CHECK (type IN ('multiple', 'truefalse', 'open')),
  question TEXT NOT NULL,
  options JSONB,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PROFILES (gebruikers, geen koppeling met auth.users meer)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  coins INT DEFAULT 100,
  selected_skin VARCHAR(50) DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SAVED QUIZZES
CREATE TABLE IF NOT EXISTS saved_quizzes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SAVED QUESTIONS
CREATE TABLE IF NOT EXISTS saved_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id UUID REFERENCES saved_quizzes(id) ON DELETE CASCADE NOT NULL,
  question_index INT NOT NULL,
  type VARCHAR(20) DEFAULT 'multiple' CHECK (type IN ('multiple', 'truefalse', 'open')),
  question TEXT NOT NULL,
  options JSONB,
  answer TEXT NOT NULL
);

-- SKINS
CREATE TABLE IF NOT EXISTS skins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  price INT NOT NULL,
  primary_color VARCHAR(7) DEFAULT '#e94560',
  bg_start VARCHAR(7) DEFAULT '#1a1a2e',
  bg_end VARCHAR(7) DEFAULT '#0f3460',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USER SKINS
CREATE TABLE IF NOT EXISTS user_skins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  skin_id UUID REFERENCES skins(id) ON DELETE CASCADE NOT NULL,
  UNIQUE(user_id, skin_id)
);

-- RLS
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skins ENABLE ROW LEVEL SECURITY;

-- POLICIES (alles toegestaan)
DO $$ BEGIN
  CREATE POLICY "Allow all on questions" ON questions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on games" ON games FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on players" ON players FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on answers" ON answers FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on profiles" ON profiles FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on saved_quizzes" ON saved_quizzes FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on saved_questions" ON saved_questions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on skins" ON skins FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on user_skins" ON user_skins FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- REALTIME
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE questions; EXCEPTION WHEN OTHERS THEN null; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE games; EXCEPTION WHEN OTHERS THEN null; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE players; EXCEPTION WHEN OTHERS THEN null; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE answers; EXCEPTION WHEN OTHERS THEN null; END $$;

-- SEED SKINS
INSERT INTO skins (name, display_name, description, price, primary_color, bg_start, bg_end) VALUES
('default', 'Standaard', 'De standaard rood-blauwe look', 0, '#e94560', '#1a1a2e', '#0f3460'),
('ocean', 'Oceaan', 'Koel blauw thema', 50, '#00b4d8', '#03045e', '#0077b6'),
('forest', 'Bos', 'Natuurlijk groen thema', 75, '#2d6a4f', '#081c15', '#1b4332'),
('sunset', 'Zonsondergang', 'Warme paars-oranje look', 100, '#ff6b6b', '#2d1b69', '#e74c3d'),
('midnight', 'Middernacht', 'Donker paars thema', 150, '#bb86fc', '#121212', '#3700b3'),
('gold', 'Goud', 'Luxe gouden look', 200, '#ffd700', '#1a1a00', '#665d00')
ON CONFLICT (name) DO NOTHING;

-- ==================== AUTH RPC's ====================

DROP FUNCTION IF EXISTS register_user;
DROP FUNCTION IF EXISTS login_user;

-- REGISTREREN (enkel JSONB parameter om PostgREST cache problemen te vermijden)
CREATE OR REPLACE FUNCTION register_user(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_username TEXT;
  v_password TEXT;
BEGIN
  v_username := payload->>'username';
  v_password := payload->>'password';
  INSERT INTO public.profiles (username, password_hash, coins, selected_skin)
  VALUES (v_username, crypt(v_password, gen_salt('bf')), 100, 'default')
  RETURNING * INTO v_user;
  RETURN jsonb_build_object(
    'id', v_user.id,
    'username', v_user.username,
    'coins', v_user.coins,
    'selected_skin', v_user.selected_skin
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'Deze gebruikersnaam is al in gebruik.');
END;
$$;

-- INLOGGEN (enkel JSONB parameter)
CREATE OR REPLACE FUNCTION login_user(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_username TEXT;
  v_password TEXT;
BEGIN
  v_username := payload->>'username';
  v_password := payload->>'password';
  SELECT * INTO v_user FROM public.profiles WHERE username = v_username;
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Gebruiker niet gevonden');
  END IF;
  IF v_user.password_hash = crypt(v_password, v_user.password_hash) THEN
    RETURN jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'coins', v_user.coins,
      'selected_skin', v_user.selected_skin
    );
  ELSE
    RETURN jsonb_build_object('error', 'Ongeldig wachtwoord');
  END IF;
END;
$$;
