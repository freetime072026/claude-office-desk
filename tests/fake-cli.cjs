// CLI giả cho chat-process.test.cjs. Prompt chứa [clixml] → chỉ ghi stderr CLIXML rồi thoát mã 1;
// [clixml+error] → ghi thêm một dòng lỗi thật xen giữa các khối CLIXML.
const CLIXML = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN>\r\n<MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV></PR></MS></Obj></Objs>\r\n';
const USAGE = { input_tokens: 1200, output_tokens: 345, cache_read_input_tokens: 5000, cache_creation_input_tokens: 800 };
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  if (input.includes('[clixml')) {
    process.stderr.write(CLIXML + (input.includes('[clixml+error]') ? 'Login required\r\n' + CLIXML : ''));
    process.exitCode = 1; return;
  }
  const answer = 'Echo: ' + input.trim();
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: answer } } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: 'mock-native-session', result: answer, usage: USAGE, total_cost_usd: 0.0421, num_turns: 3 }) + '\n');
});
