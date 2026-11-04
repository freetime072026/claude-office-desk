// Tham chiếu tệp trong chat: `code`, [nhãn](đường dẫn), ![ảnh](đường dẫn), URL http(s) và đường dẫn trần (Assets/x.png, D:\a\b.md:12).
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)(?::\d+(?::\d+)?)?$/i;
const FILE_EXT = 'png|jpe?g|gif|webp|bmp|ico|svg|md|txt|json|csv|tsv|ya?ml|xml|cs|c?js|mjs|jsx|tsx?|html?|s?css|shader|hlsl|cginc|glsl|py|lua|gd|ps1|bat|cmd|sh|log|toml|ini|cfg|uxml|uss|prefab|unity|asset|mat|meta|asmdef|anim|controller|shadergraph';
// Không có thư mục thì chỉ nhận đuôi ít gây nhầm (tránh "Node.js", "Vue.js" thành link).
const BARE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|md|txt|json|csv|ya?ml|cs|prefab|unity|asset|mat|shader|uxml|uss|log)(?::\d+(?::\d+)?)?$/i;
const W = '\\p{L}\\p{N}_'; // chữ/số Unicode: tên tệp tiếng Việt không bị cắt giữa chừng.
const TOKEN = new RegExp([
  '`([^`]+)`',
  '!\\[([^\\]]*)\\]\\((<[^>]+>|[^)\\s]+)(?:\\s+"[^"]*")?\\)',
  '\\[([^\\]]+)\\]\\((<[^>]+>|[^)\\s]+)(?:\\s+"[^"]*")?\\)',
  '\\*\\*([^*]+)\\*\\*',
  '((?:https?|file)://[^\\s<>()"`]+[^\\s<>()"`.,;:!?\'])',
  '((?<![' + W + './\\\\:@-])(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/]|[\\\\/])?(?:[' + W + '.@-]+[\\\\/])*[' + W + '@-][' + W + '.@-]*\\.(?:' + FILE_EXT + ')(?::\\d+(?::\\d+)?)?(?!\\.?[' + W + '/\\\\-]))'
].join('|'), 'giu');
const isExternal = target => /^[a-z][a-z0-9+.-]+:/i.test(target) && !/^[a-z]:[\\/]/i.test(target) && !/^file:/i.test(target);
const unwrap = target => target.replace(/^<(.+)>$/, '$1');
function fileButton(label, reference) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'file-reference' + (IMAGE_FILE.test(reference.replace(/[?#].*$/, '')) ? ' image-reference' : '');
  button.textContent = label; button.title = reference; button.onclick = () => window.openChatFile?.(reference); return button;
}
function urlButton(label, url) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'file-reference'; button.textContent = label; button.title = url;
  button.onclick = () => Promise.resolve(window.office?.run('open-url', { url })).catch(() => {}); return button;
}
// Ảnh nhúng bằng ![alt](đường dẫn): hiển thị ngay trong tin; bấm để xem lớn. Không đọc được thì quay về nút tên tệp.
function inlineImage(alt, reference) {
  const image = document.createElement('img'); image.className = 'chat-image'; image.alt = alt || reference; image.title = reference;
  image.onclick = () => window.openChatFile?.(reference);
  Promise.resolve(window.loadChatImage?.(reference)).then(url => { if (url) image.src = url; else image.replaceWith(fileButton(alt || reference, reference)); }, () => image.replaceWith(fileButton(alt || reference, reference)));
  return image;
}
function inline(element, value) {
  let last = 0;
  for (const match of value.matchAll(TOKEN)) {
    if (match.index > last) element.append(document.createTextNode(value.slice(last, match.index)));
    last = match.index + match[0].length;
    const [, code, imageAlt, imageTarget, linkLabel, linkTarget, bold, url, bare] = match;
    if (code !== undefined) {
      const span = document.createElement('code'); span.textContent = code;
      if (/^https?:\/\/\S+$/i.test(code)) span.replaceChildren(urlButton(code, code));
      else if (/\.[a-zA-Z0-9]{1,12}(?::\d+(?::\d+)?)?$/.test(code) && !/\s/.test(code.trim()) || IMAGE_FILE.test(code)) span.replaceChildren(fileButton(code, code));
      element.append(span);
    } else if (imageTarget !== undefined) {
      const target = unwrap(imageTarget);
      if (isExternal(target)) element.append(/^https?:/i.test(target) ? urlButton(imageAlt || target, target) : document.createTextNode(match[0]));
      else element.append(inlineImage(imageAlt, target));
    } else if (linkTarget !== undefined) {
      const target = unwrap(linkTarget), label = linkLabel.replace(/`/g, '');
      if (isExternal(target)) element.append(/^https?:/i.test(target) ? urlButton(label, target) : document.createTextNode(label));
      else element.append(fileButton(label, target));
    } else if (bold !== undefined) { const strong = document.createElement('strong'); inline(strong, bold); element.append(strong); }
    else if (url !== undefined) element.append(/^file:/i.test(url) ? fileButton(url, url) : urlButton(url, url));
    else if (bare !== undefined && (/[\\/]/.test(bare) || BARE_NAME.test(bare))) element.append(fileButton(bare, bare));
    else element.append(document.createTextNode(match[0]));
  }
  if (last < value.length) element.append(document.createTextNode(value.slice(last)));
}
window.renderChatText = text => {
  const root = document.createElement('div'); root.className = 'chat-text';
  let code, list;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { if (code) code = undefined; else { const pre = document.createElement('pre'); code = document.createElement('code'); const body = code; const copy = document.createElement('button'); copy.className = 'copy-code'; copy.textContent = 'Copy'; copy.type = 'button'; copy.onclick = async () => { try { await window.office.run('copy-text', { text: body.textContent }); copy.textContent = '✓ Copied'; } catch { copy.textContent = 'Không copy được'; } }; pre.append(copy, code); root.append(pre); } list = undefined; continue; }
    if (code) { code.textContent += line + '\n'; continue; }
    if (/^\s*[-*] /.test(line)) { if (!list) { list = document.createElement('ul'); root.append(list); } const item = document.createElement('li'); inline(item, line.replace(/^\s*[-*] /, '')); list.append(item); continue; }
    list = undefined; const heading = /^(#{1,4})\s+(.+)$/.exec(line); const element = document.createElement(heading ? 'h' + Math.min(heading[1].length + 1, 5) : 'p'); inline(element, heading ? heading[2] : line); root.append(element);
  }
  return root;
};
