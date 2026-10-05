jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const {
  buildCliInvocation,
  buildCliEnvironment,
  runCliCommand
} = require('../../src/utils/aiCliProvider');

function createChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = jest.fn();
  child.kill = jest.fn();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

describe('AI CLI provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CODEX_CLI_PATH;
    delete process.env.CLAUDE_CLI_PATH;
  });

  test('builds an isolated non-interactive Codex invocation', () => {
    const invocation = buildCliInvocation('codex_cli', 'gpt-test', '/tmp/tradetally-ai-test');

    expect(invocation.executable).toBe('codex');
    expect(invocation.args).toEqual(expect.arrayContaining([
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--ignore-rules',
      '--cd',
      '/tmp/tradetally-ai-test',
      '--model',
      'gpt-test',
      '-'
    ]));
  });

  test('builds a tool-free non-interactive Claude invocation', () => {
    process.env.CLAUDE_CLI_PATH = '/opt/claude';
    const invocation = buildCliInvocation('claude_cli', '', '/tmp/tradetally-ai-test');

    expect(invocation.executable).toBe('/opt/claude');
    expect(invocation.args).toEqual([
      '--print',
      '--safe-mode',
      '--tools',
      '',
      '--no-session-persistence',
      '--output-format',
      'text'
    ]);
  });

  test('excludes backend and API billing credentials from Codex environment', () => {
    const originalEnv = process.env;
    try {
      process.env = { PATH: '/usr/bin', HOME: '/home/appuser', CODEX_HOME: '/private/codex',
        DB_PASSWORD: 'private-database-secret', OPENAI_API_KEY: 'private-api-secret',
        CODEX_API_KEY: 'private-codex-secret', BROKER_TOKEN: 'private-broker-secret' };
      expect(buildCliEnvironment('codex_cli')).toEqual({
        PATH: '/usr/bin', HOME: '/home/appuser', CODEX_HOME: '/private/codex'
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('disables command tools and forces ChatGPT authentication when configured', () => {
    const previous = process.env.CODEX_CLI_AUTH_MODE;
    try {
      process.env.CODEX_CLI_AUTH_MODE = 'chatgpt';
      expect(buildCliInvocation('codex_cli', '', '/tmp').args).toEqual(expect.arrayContaining([
        'features.shell_tool=false', 'features.unified_exec=false',
        'web_search="disabled"', 'forced_login_method="chatgpt"'
      ]));
    } finally {
      if (previous === undefined) delete process.env.CODEX_CLI_AUTH_MODE;
      else process.env.CODEX_CLI_AUTH_MODE = previous;
    }
  });

  test('does not expose CLI diagnostics in failure messages', async () => {
    const child = createChildProcess();
    spawn.mockReturnValue(child);
    const result = runCliCommand('codex_cli', 'codex', [], 'Prompt', '/tmp');
    child.stderr.emit('data', Buffer.from('unauthorized secret-token private-account'));
    child.emit('close', 1);
    await expect(result).rejects.toThrow('Complete the CLI login');
    await expect(result).rejects.not.toThrow('secret-token');
  });

  test('passes the prompt on stdin and returns stdout', async () => {
    const child = createChildProcess();
    spawn.mockReturnValue(child);

    const responsePromise = runCliCommand(
      'claude_cli',
      'claude',
      ['--print'],
      'Analyze this trade',
      '/tmp'
    );

    expect(spawn).toHaveBeenCalledWith('claude', ['--print'], expect.objectContaining({
      cwd: '/tmp',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    }));
    expect(child.stdin.end).toHaveBeenCalledWith('Analyze this trade');

    child.stdout.emit('data', Buffer.from('Focused analysis\n'));
    child.emit('close', 0);

    await expect(responsePromise).resolves.toBe('Focused analysis');
  });

  test('reports a missing executable with setup guidance', async () => {
    const child = createChildProcess();
    spawn.mockReturnValue(child);

    const responsePromise = runCliCommand('codex_cli', 'codex', [], 'Prompt', '/tmp');
    const error = new Error('spawn codex ENOENT');
    error.code = 'ENOENT';
    child.emit('error', error);

    await expect(responsePromise).rejects.toThrow('set CODEX_CLI_PATH');
  });
});
