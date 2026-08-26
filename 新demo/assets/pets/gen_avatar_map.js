const fs = require('fs'), vm = require('vm');
const SRC = 'd:/Ai/游戏原型/新demo/Mvp/原型代码/js/core/pet-sprites.js';
const DST = 'd:/Ai/游戏原型/新demo/Mvp/原型代码/_avatar_map_inline.txt';
const c = { window: {} }; c.window = c; vm.createContext(c);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), c);
const P = c.window.PetSprites;
const m = {};
for (const k of Object.keys(P.avatarMap)) m[k] = P.avatarMap[k] + '?v=' + P.V;
const s = 'const AVATAR_MAP = ' + JSON.stringify(m) + ';\n' +
  'function avatarPath(n){if(!n)return null;if(AVATAR_MAP[n])return AVATAR_MAP[n];if(n.indexOf("\u00b7\u5f02\u53d8")>0)return AVATAR_MAP[n.replace("\u00b7\u5f02\u53d8","")]||null;return null;}';
fs.writeFileSync(DST, s);
console.log('size:', s.length, 'keys:', Object.keys(m).length);
