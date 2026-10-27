/* ===========================================================
   sw.js  ―  アプリを「ホーム画面に追加」したとき、電波が弱くても開けるようにする係
   -----------------------------------------------------------
   ・ネットにつながっているときは、いつも最新のファイルを取りにいく
   ・つながらないときは、前に開いたときに覚えておいたファイルで開く
   ・家計簿のデータそのものは、ここでは扱いません（アプリ本体のファイルだけ）
   ※ ファイルを大きく変えたら、下の CACHE_NAME の数字を上げてください
   =========================================================== */

const CACHE_NAME = 'mamecho-v28';

// 最初に覚えておくファイル（アプリ本体）。電波がなくても開けるように、プログラム（js）も全部入れる。
// ※ js のファイルを増やしたり名前を変えたりしたら、ここにも書き足すこと
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/vendor/papaparse.min.js',
  './js/01-categories.js',
  './js/02-card-companies.js',
  './js/03-helpers.js',
  './js/04-state-and-storage.js',
  './js/05-calculations.js',
  './js/06-credit-card-billing.js',
  './js/07-charts.js',
  './js/08-screen-home.js',
  './js/09-screen-transactions.js',
  './js/10-screen-report.js',
  './js/11-screen-budget.js',
  './js/12-screen-cards.js',
  './js/13-screen-accounts.js',
  './js/14-screen-settings.js',
  './js/15-dialog-transaction.js',
  './js/16-dialog-account.js',
  './js/17-csv-and-backup.js',
  './js/18-ai-features.js',
  './js/19-sample-data.js',
  './js/20-rules-alerts.js',
  './js/21-encryption-lock.js',
  './js/22-take-home-pay.js',
  './js/23-app-start.js',
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
// cache: 'no-cache' … ブラウザが覚えている古いファイル（GitHub Pages は10分ほど覚えさせる）を使わず、
//                     毎回サーバーに「新しくなった？」と確かめてから使う。更新がすぐ届くようにするため
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
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // 電波がないとき: 覚えておいたファイルを使う。ページそのもの（index.html）の代わりは、ページを開くときだけ
      .catch(() => caches.match(request).then((saved) => saved || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
