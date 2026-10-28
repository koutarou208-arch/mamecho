/* ===========================================================
   tests/finish.js  ―  テストのしめくくり
   -----------------------------------------------------------
   run.sh が tests.js → patterns.js → このファイル の順につなげて動かします。
   暗号のテスト（時間がかかる計算を待つ）をしてから、合格・不合格の数を出します。
   =========================================================== */

runEncryptionTests()
  .then(runEncryptionPatternTests)
  .catch((error) => {
    failures = failures + 1;
    print('✗ 暗号のテストが途中で止まりました: ' + error);
  })
  .then(printResults);
