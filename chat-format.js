window.renderChatText = text => {
  const root = document.createElement('div'); root.className = 'chat-text';
  let code, list;
  const inline = (element, value) => { for (const part of value.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) { if (part.startsWith('`') && part.endsWith('`')) { const reference = part.slice(1, -1); const span = document.createElement('code'); span.textContent = reference; if (/\.[a-zA-Z0-9]{1,8}(?::\d+(?::\d+)?)?$/.test(reference)) { const button = document.createElement('button'); button.className = 'file-reference'; button.textContent = reference; button.onclick = () => window.openChatFile?.(reference); span.replaceChildren(button); } element.append(span); } else if (part.startsWith('**') && part.endsWith('**')) { const span = document.createElement('strong'); span.textContent = part.slice(2, -2); element.append(span); } else element.append(document.createTextNode(part)); } };
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { if (code) code = undefined; else { const pre = document.createElement('pre'); code = document.createElement('code'); const body = code; const copy = document.createElement('button'); copy.className = 'copy-code'; copy.textContent = 'Copy'; copy.type = 'button'; copy.onclick = async () => { try { await window.office.run('copy-text', { text: body.textContent }); copy.textContent = '✓ Copied'; } catch { copy.textContent = 'Không copy được'; } }; pre.append(copy, code); root.append(pre); } list = undefined; continue; }
    if (code) { code.textContent += line + '\n'; continue; }
    if (/^\s*[-*] /.test(line)) { if (!list) { list = document.createElement('ul'); root.append(list); } const item = document.createElement('li'); inline(item, line.replace(/^\s*[-*] /, '')); list.append(item); continue; }
    list = undefined; const heading = /^(#{1,4})\s+(.+)$/.exec(line); const element = document.createElement(heading ? 'h' + Math.min(heading[1].length + 1, 5) : 'p'); inline(element, heading ? heading[2] : line); root.append(element);
  }
  return root;
};
