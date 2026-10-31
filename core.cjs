const path = require('node:path');
function profileDir(root, id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw Error('Hồ sơ không hợp lệ');
  return path.join(root, 'profiles', id);
}
function cleanEnv(source, directory) {
  const env = { ...source };
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|AWS_|GOOGLE_|AZURE_|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$|BASH_ENV$|ENV$)/i.test(key)) delete env[key];
  env.CLAUDE_CONFIG_DIR = directory;
  env.DISABLE_TELEMETRY = '1';
  env.DISABLE_ERROR_REPORTING = '1';
  return env;
}
function sessionArgs(settings, mcp) {
  return ['--permission-mode', 'default', '--setting-sources', 'user', '--settings', settings, '--strict-mcp-config', '--mcp-config', mcp, '--no-chrome', '--tools', 'Read,Glob,Grep,Write,Edit,Bash'];
}
function psLiteral(value) { return "'" + value.replaceAll("'", "''") + "'"; }
function commandFor(executable, args) { return '& ' + [executable, ...args].map(psLiteral).join(' ') + '; exit $LASTEXITCODE'; }
module.exports = { profileDir, cleanEnv, sessionArgs, psLiteral, commandFor };
