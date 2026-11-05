// CLI giả cho chat-process.test.cjs, nói giao thức stream-json hai chiều như Claude Code --input-format stream-json.
// Prompt chứa [clixml] → chỉ ghi stderr CLIXML rồi thoát mã 1; [clixml+error] → thêm một dòng lỗi thật.
// [ask:Tên] → gửi control_request can_use_tool cho tool đó, chờ control_response rồi trả lời theo quyết định.
// [linger] → trả lời rồi không thoát khi stdin đóng (như CLI còn chờ tác vụ nền: dev server QA bỏ lại).
// Chỉ thoát khi stdin đóng (app phải đóng stdin sau event result), giống CLI thật.
const CLIXML = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN>\r\n<MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV></PR></MS></Obj></Objs>\r\n';
const USAGE = { input_tokens: 1200, output_tokens: 345, cache_read_input_tokens: 5000, cache_creation_input_tokens: 800 };
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
let buffer = '', started = false, linger = false; const waiting = new Map();
function reply(answer) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: answer } } });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
  out({ type: 'result', session_id: 'mock-native-session', result: answer, usage: USAGE, total_cost_usd: 0.0421, num_turns: 3, args: process.argv.slice(2) });
}
function handle(message) {
  if (message.type === 'control_response') { waiting.get(message.response.request_id)?.(message.response); return; }
  if (message.type !== 'user' || started) return; started = true;
  const prompt = message.message.content.map(block => block.text).join('');
  if (prompt.includes('[clixml')) { process.stderr.write(CLIXML + (prompt.includes('[clixml+error]') ? 'Login required\r\n' + CLIXML : '')); process.exit(1); }
  if (prompt.includes('[linger]')) linger = true;
  const ask = /\[ask:([\w]+)\]/.exec(prompt);
  if (prompt.includes('[args]')) { reply(JSON.stringify(process.argv.slice(2))); return; }
  if (prompt.includes('[env]')) { reply(JSON.stringify({ BASH_DEFAULT_TIMEOUT_MS: process.env.BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS: process.env.BASH_MAX_TIMEOUT_MS })); return; }
  if (!ask) { reply('Echo: ' + prompt.trim()); return; }
  waiting.set('req-1', response => { const decision = response.response; reply(`${ask[1]} ${decision.behavior}` + (decision.behavior === 'allow' ? ' ' + JSON.stringify(decision.updatedInput) : ': ' + decision.message)); });
  out({ type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: ask[1], input: { command: 'echo hi' }, tool_use_id: 'tool-1' } });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) if (line.trim()) handle(JSON.parse(line)); });
process.stdin.on('end', () => { if (linger) setInterval(() => {}, 1000); else process.exit(0); });
