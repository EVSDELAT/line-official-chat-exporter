// LINE官方帳號對話匯出 v2.0.0
//
// 架構：直接呼叫 LINE OA 後台的內部訊息 API（與後台頁面本身用的同一個），
// GET /api/v3/bots/{botId}/chats/{chatId}/messages?limit=100&backward={cursor}
// 用使用者自己的登入 session（credentials:include），分頁抓回完整記錄。
// 顧客名稱取自對話頁頂部的 h3 標題。
//
// 輸出格式：[2026/10/14 13:37] 顧客：余陳台第一次手動連接，之後是啟動摩托車就可以自動連線麼
// 檔名：顧客：余陳台 LINE官方帳號對話 2026-10-14 13-37.txt
// 資料只存在使用者電腦，不上傳到任何伺服器。
(() => {
'use strict';

const PAGE_LIMIT = 100;
const MAX_PAGES = 600;
const MAX_MESSAGES = 12000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, ms = 5000) {
let t = document.getElementById('pg-export-toast');
if (!t) {
t = document.createElement('div');
t.id = 'pg-export-toast';
t.style.cssText = 'position:fixed;right:20px;bottom:76px;z-index:2147483647;'
+ 'background:#141414;color:#fff;padding:10px 16px;border-radius:8px;'
+ 'font-size:14px;max-width:340px;box-shadow:0 2px 12px rgba(0,0,0,.35);'
+ 'font-family:sans-serif;white-space:pre-line;';
document.body.appendChild(t);
}
t.textContent = msg;
t.style.display = 'block';
clearTimeout(t._h);
t._h = setTimeout(() => { t.style.display = 'none';}, ms);
}

function chatIds() {
const m = location.href.match(/^https:\/\/chat\.line\.biz\/([^/?#]+)\/chat\/([^/?#]+)/i);
return m? { botId: m[1], chatId: m[2]}: null;
}

function isVisible(el) {
if (!el ||!(el instanceof Element)) return false;
const s = getComputedStyle(el);
if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
const r = el.getBoundingClientRect();
return r.width > 0 && r.height > 0;
}

function cleanName(t) {
return String(t || '')
.replace(/[\]]/g, ' ')
.replace(/\s+/g, ' ')
.trim()
.replace(/^(?:[-－—]\s*)+/, '')
.trim();
}

function plausible(t) {
t = (t || '').trim();
if (!t || t.length > 60) return false;
if (/聊天|官方|設定|負責人員|記事本|搜尋|待處理|處理完畢/.test(t)) return false;
return true;
}

// 顧客名稱：對話頁頂部 h3 標題（在 div.border-bottom 面板內）
function findCustomerName() {
for (const h of document.querySelectorAll('h3')) {
if (!isVisible(h)) continue;
if (!h.closest('div.border-bottom')) continue;
const t = (h.innerText || '').trim().split('\n')[0].trim();
if (plausible(t)) return cleanName(t) || t;
}
// 備援：頁面頂部的 h4
const cands = [];
for (const h of document.querySelectorAll('h4')) {
if (!isVisible(h)) continue;
const r = h.getBoundingClientRect();
if (r.top > 240) continue;
const t = (h.innerText || '').trim().split('\n')[0].trim();
if (plausible(t) && t!== '聊天室') cands.push({ t, top: r.top, left: r.left});
}
cands.sort((a, b) => a.top - b.top || a.left - b.left);
return cands.length? cleanName(cands[0].t) || cands[0].t: '';
}

async function fetchAll(botId, chatId, onProgress) {
const all = [];
const seenCursors = new Set();
let backward = '';
for (let page = 0; page < MAX_PAGES; page++) {
const q = new URLSearchParams({ limit: String(PAGE_LIMIT)});
if (backward) q.set('backward', backward);
const url = `/api/v3/bots/${encodeURIComponent(botId)}/chats/${encodeURIComponent(chatId)}/messages?${q}`;
let res;
try {
res = await fetch(url, {
method: 'GET',
credentials: 'include',
cache: 'no-store',
headers: { 'Accept': 'application/json'},
});
} catch (e) {
throw new Error('連線失敗：' + e.message);
}
if (!res.ok) {
if (res.status === 401 || res.status === 403) {
throw new Error('LINE 登入狀態已失效，請重新登入後台後再試一次。');
}
throw new Error('讀取聊天記錄失敗（' + res.status + '）。');
}
const data = await res.json();
const list = Array.isArray(data && data.list)? data.list: [];
all.push(...list);
if (onProgress) onProgress(all.length);
if (all.length > MAX_MESSAGES) break;
const next = String((data && data.backward) || '');
if (!next ||!list.length || seenCursors.has(next)) break;
seenCursors.add(next);
backward = next;
}
return all;
}

function msgContent(item) {
if (!item || typeof item!== 'object') return '';
if (item.unsend || item.unsent) return '[已收回訊息]';
const m = item.message && typeof item.message === 'object'? item.message: {};
const text = String(m.text || '').replace(/\u00a0/g, ' ').trim();
if (text) return text;
const type = String(m.type || m.originalType || '').toLowerCase();
if (type === 'sticker') return '[貼圖]';
if (type === 'image') return '[圖片]';
if (type === 'video') return '[影片]';
if (type === 'audio') return '[語音訊息]';
if (type === 'file') return m.fileName? '[檔案] ' + m.fileName: '[檔案]';
if (type === 'location') {
const t = String(m.title || m.address || '').trim();
return t || '[位置]';
}
return '';
}

function fmtDateTime(ts) {
const d = new Date(ts);
const p = (v) => String(v).padStart(2, '0');
return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate())
+ ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function buildRows(items, botId) {
const seen = new Set();
const rows = [];
for (const item of items) {
const content = msgContent(item);
if (!content) continue;
let ts = Number(item.timestamp || 0);
if (ts > 0 && ts < 1e12) ts *= 1000; // 秒 → 毫秒
if (!Number.isFinite(ts) || ts <= 0) continue;
const mid = String((item.message && item.message.id) || '');
const key = mid || (ts + '|' + String(item.type || '') + '|' + content);
if (seen.has(key)) continue;
seen.add(key);
const ptype = String(item.type || '').toLowerCase();
const outgoing = ptype.includes('sent')
|| String((item.source && item.source.userId) || '') === botId;
rows.push({ ts, outgoing, content});
}
rows.sort((a, b) => a.ts - b.ts);
return rows;
}

function sanitizeFilename(s) {
return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function buildText(rows, customerName) {
const now = new Date();
const L = [];
L.push('# LINE官方帳號對話匯出 v2.0');
L.push('# 顧客：' + (customerName || '（未能識別）'));
L.push('# 匯出時間：' + now.toLocaleString('zh-TW'));
L.push('# 共 ' + rows.length + ' 則訊息');
L.push('');
for (const r of rows) {
const label = r.outgoing? '客服：': '顧客：' + (customerName || '');
L.push('[' + fmtDateTime(r.ts) + '] ' + label + r.content);
}
return L.join('\n');
}

async function run() {
try {
const ids = chatIds();
if (!ids) {
toast('請先點進某位顧客的對話頁再按匯出。', 6000);
return;
}
toast('讀取完整聊天記錄中…', 2000);
const customerName = findCustomerName();
const items = await fetchAll(ids.botId, ids.chatId, (n) => {
toast('讀取完整聊天記錄中…（已載入 ' + n + ' 則）', 1500);
});
const rows = buildRows(items, ids.botId);
console.log('[peregrine-export] customer=', customerName, 'rows=', rows.length);
if (!rows.length) {
toast('沒有讀到訊息（顧客：' + (customerName || '未知') + '）。', 8000);
return;
}
const text = buildText(rows, customerName);
const now = new Date();
const p = (v) => String(v).padStart(2, '0');
const stamp = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
+ ' ' + p(now.getHours()) + '-' + p(now.getMinutes());
const fname = sanitizeFilename(
'顧客：' + (customerName || '未知') + ' LINE官方帳號對話 ' + stamp + '.txt');
const blob = new Blob([text], { type: 'text/plain;charset=utf-8'});
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = fname;
document.body.appendChild(a);
a.click();
setTimeout(() => { URL.revokeObjectURL(a.href); a.remove();}, 2000);
toast('完成！顧客：' + (customerName || '（未識別到名字）') + '，共 ' + rows.length + ' 則，已存檔。', 6000);
} catch (e) {
console.error('[peregrine-export]', e);
toast('匯出失敗：' + e.message, 9000);
}
}

function mountButton() {
if (document.getElementById('pg-export-btn')) return;
const b = document.createElement('button');
b.id = 'pg-export-btn';
b.textContent = '匯出對話.txt';
b.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;'
+ 'background:#c8102e;color:#fff;border:none;border-radius:24px;'
+ 'padding:12px 20px;font-size:15px;font-weight:700;cursor:pointer;'
+ 'box-shadow:0 2px 12px rgba(0,0,0,.35);font-family:sans-serif;';
b.addEventListener('click', run);
document.body.appendChild(b);
}

mountButton();
setInterval(mountButton, 3000); // SPA 切換頁時補上按鈕
})();
