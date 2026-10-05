-- Align persisted user AI settings with the providers already accepted by the UI/API.
ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS valid_ai_provider;

ALTER TABLE user_settings ADD CONSTRAINT valid_ai_provider CHECK (
  ai_provider IN ('gemini', 'claude', 'openai', 'deepseek', 'kimi',
    'codex_cli', 'claude_cli', 'ollama', 'lmstudio', 'perplexity', 'local', 'custom')
);

COMMENT ON COLUMN user_settings.ai_provider IS
  'AI provider for analytics and CUSIP lookup, including administrator-configured Codex and Claude host CLI providers';
