/* ===========================================================
   sw.js  ―  アプリを「ホーム画面に追加」したとき、電波が弱くても開けるようにする係
   -----------------------------------------------------------
   ・ネットにつながっているときは、いつも最新のファイルを取りにいく
   ・つながらないときは、前に開いたときに覚えておいたファイルで開く
   ・家計簿のデータそのものは、ここでは扱いません（アプリ本体のファイルだけ）
   ※ ファイルを大きく変えたら、下の CACHE_NAME の数字を上げてください
   =========================================================== */

const CACHE_NAME = 'mamecho-v4';

// 最初に覚えておくファイル（アプリ本体）
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// インストール: アプリ本体を覚える
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting())
  );
});

// 有効になったら、古い版の覚えを消す
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// ファイルを取りにいくとき: まずネット、だめなら覚えておいたもの
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  // 自分のサイトのファイルだけ扱う（このアプリは、よそとは通信しない）
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((saved) => saved || caches.match('./index.html')))
  );
});
