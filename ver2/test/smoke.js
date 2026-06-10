// ver2/game.js のスモークテスト：ブラウザAPIをスタブして実ロジックを駆動する
// 実行方法: node ver2/test/smoke.js
'use strict';
const fs = require('fs');
const path = require('path');

// ─ Canvas 2D コンテキストの万能スタブ ─
function makeCtxProxy() {
  const handler = {
    get(_t, p) {
      if (p === 'width') return 50;            // measureText().width 用
      if (p === Symbol.toPrimitive) return () => 0;
      return (...args) => proxy;               // メソッドは何でも呼べる
    },
    set() { return true; },                    // fillStyle 等の代入は無視
    apply() { return proxy; },
  };
  const proxy = new Proxy(function () { }, handler);
  return proxy;
}

const ctxStub = makeCtxProxy();
const canvasStub = {
  width: 800, height: 450,
  getContext: () => ctxStub,
  getBoundingClientRect: () => ({ width: 800, height: 450, left: 0, top: 0 }),
  addEventListener: () => { },
};

const storage = {};
global.localStorage = {
  getItem: k => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
};
global.window = { addEventListener: () => { }, devicePixelRatio: 1 };
global.document = {
  getElementById: () => canvasStub,
  addEventListener: () => { },
};
global.ResizeObserver = class { observe() { } };
global.requestAnimationFrame = () => { };

const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

// ゲーム内部へアクセスするためのフックを末尾に追加して評価
const driver = `
;globalThis.__game = {
  update, draw, startGame, acquirePerk, perkLevel, maxHp, maxAirJumps,
  rollPerkChoices, onKeyDown, handlePointerDown,
  player, STATE,
  state: () => state,
  perkChoices: () => perkChoices,
  scrollX: () => scrollX,
  enemies: () => enemies,
  powerups: () => powerups,
  perkGate: () => perkGate,
  postPerkCalm: () => postPerkCalm,
  chickPositions,
  shockwaves: () => shockwaves,
  perksTaken: () => perksTaken,
  goalDist: () => goalDist,
  goalGate: () => goalGate,
};
`;
eval(src + driver);
const g = globalThis.__game;

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failures++;
}

// ─ 1. タイトル→ゲーム開始 ─
for (let i = 0; i < 100; i++) g.update();   // タイトル状態で空回し
g.draw();
g.startGame();
check('startGame で PLAYING になる', g.state() === g.STATE.PLAYING);
check('開始時パークなし', Object.keys(g.player.perks).length === 0);

// ─ 2. 走行→ゲート出現→通過でパーク選択が発生する ─
g.player.invincible = 999999;  // テスト用：被弾死を防いで進行のみ確認
let sawGate = false;
let spawnDuringGate = false;
let itemSpawnDuringGate = false;
let reachedChoice = false;
for (let i = 0; i < 20000 && !reachedChoice; i++) {
  const enemiesBefore = g.enemies().length;
  const powerupsBefore = g.powerups().length;
  g.update();
  if (g.perkGate()) {
    sawGate = true;
    if (g.enemies().length > enemiesBefore) spawnDuringGate = true;
    if (g.powerups().length > powerupsBefore) itemSpawnDuringGate = true;
  }
  if (g.state() === g.STATE.PERK_CHOICE) reachedChoice = true;
}
check('ゲートが出現する', sawGate);
check('ゲート存在中は敵がスポーンしない', !spawnDuringGate);
check('ゲート存在中はアイテムもスポーンしない', !itemSpawnDuringGate);
check('ゲート通過でパーク選択が発生する', reachedChoice);
check('選択開始時に動いている敵がいない', g.enemies().every(e => e.knocked));
check('通過後にゲートが消える', g.perkGate() === null);
check('選択後のスポーン停止タイマーが作動', g.postPerkCalm() > 0);
check('選択肢が1〜4件提示される', g.perkChoices().length >= 1 && g.perkChoices().length <= 4);
g.draw();  // 選択画面の描画がエラーを出さないこと

// 選択中はゲームが止まること
const distBefore = g.scrollX();
for (let i = 0; i < 50; i++) g.update();
check('選択中はスクロールが止まる', g.scrollX() === distBefore);

// ─ 3. キー入力でパークを取得して再開する ─
const firstPerk = g.perkChoices()[0];
g.onKeyDown('Digit1');
check('パーク取得後に PLAYING へ戻る', g.state() === g.STATE.PLAYING);
check('取得したパークのレベルが1になる', g.perkLevel(firstPerk.id) === 1 || firstPerk.instant);

// ─ 4. 各パークの効果が反映される ─
g.player.perks = { jump: 1, heartUp: 1 };
check('もう1段ジャンプ: 空中ジャンプ上限 2→3', g.maxAirJumps() === 3);
check('大きなハート: 上限 3→4', g.maxHp() === 4);

// 廃止パークがプールに残っていないこと＋全パークが抽選されること（均等確率）
const poolIds = new Set();
g.player.perks = {};
g.player.hp = 1;
for (let i = 0; i < 300; i++) g.rollPerkChoices().forEach(p => poolIds.add(p.id));
check('廃止パーク（fly/crown/combo/glass/revive）が抽選されない',
  !['fly', 'crown', 'combo', 'glass', 'revive'].some(id => poolIds.has(id)));
check('通常時は8パークのみ抽選対象（かくしパークは出ない）',
  poolIds.size === 8 && !poolIds.has('punchShock') && !poolIds.has('chickShock'));

// かくしパーク：条件が揃うと通常3枚＋かくし1枚の計4枚が必ず提示される
g.player.perks = { shock: 1, glove: 1, chick: 1 };
g.player.hp = g.maxHp();
const hiddenIds = new Set();
let alwaysFourWithOneHidden = true;
for (let i = 0; i < 300; i++) {
  const picks = g.rollPerkChoices();
  const hiddenPicks = picks.filter(p => p.hidden);
  if (picks.length !== 4 || hiddenPicks.length !== 1) alwaysFourWithOneHidden = false;
  hiddenPicks.forEach(p => hiddenIds.add(p.id));
}
check('条件成立時は常に4枚（うち かくし1枚）が提示される', alwaysFourWithOneHidden);
check('パンチドッカーンとちびドッカーンの両方が出うる',
  hiddenIds.has('punchShock') && hiddenIds.has('chickShock'));
// 片方の条件だけならそのかくしパークが確定で出る
g.player.perks = { shock: 1, glove: 1 };
check('グローブ側のみ条件成立ならパンチドッカーン固定',
  g.rollPerkChoices().filter(p => p.hidden).every(p => p.id === 'punchShock'));

// 取得済みパークが選ばれやすいこと（統計的に確認）
g.player.perks = { shock: 1 };  // shock のみ取得済み、jump は未取得
g.player.hp = g.maxHp();        // 満タンにして heal を除外
let shockCount = 0, jumpCount = 0;
for (let i = 0; i < 3000; i++) {
  const picks = g.rollPerkChoices();
  if (picks.some(p => p.id === 'shock')) shockCount++;
  if (picks.some(p => p.id === 'jump')) jumpCount++;
}
check(`取得済みパークが未取得より選ばれやすい（shock:${shockCount} > jump:${jumpCount}）`,
  shockCount > jumpCount * 1.2);

// ストンプ衝撃波：リング演出が出て周囲の敵も倒れる
g.startGame();
g.player.perks = { shock: 1 };
g.player.invincible = 999999;
g.player.x = 130; g.player.y = 200; g.player.onGround = false;
g.player.vy = 5;  // 落下中（ストンプ姿勢）
g.enemies().length = 0;
g.enemies().push({ type: 'seal', x: 130, y: 258, w: 64, h: 42, speed: 0, animTimer: 0, phase: 0 });
g.enemies().push({ type: 'seal', x: 200, y: 258, w: 64, h: 42, speed: 0, animTimer: 0, phase: 0 });  // 半径150以内
g.update();
check('ストンプで衝撃波リングが発生する', g.shockwaves().length === 1);
check('衝撃波リングの半径が効果範囲と一致（Lv.1=150px）', g.shockwaves()[0]?.maxR === 150);
check('発生直後はリングがまだ届かず遠くの敵は無事', g.enemies()[1].knocked !== true);
for (let i = 0; i < 24; i++) g.update();
check('リングの広がりに合わせて範囲内の敵が倒れる', g.enemies().every(e => e.knocked));
check('リングは寿命で消える', g.shockwaves().length === 0);

// ─ 4.5. 新パーク：ちびペンギンとグローブパンチ ─
g.startGame();
g.player.invincible = 999999;
g.player.perks = { chick: 4 };
check('ちびペンギン Lv.4: 4匹が周回', g.chickPositions().length === 4);
g.player.perks = { chick: 2 };
{
  const c = g.chickPositions()[0];
  g.enemies().length = 0;
  g.enemies().push({ type: 'seal', x: c.x - 32, y: c.y - 21, w: 64, h: 42, speed: 0, animTimer: 0, phase: 0 });
  g.update();
  check('ちびペンギンに触れた敵が吹き飛ぶ', g.enemies()[0].knocked === true);
  check('ちびドッカーン未取得ならちび撃破で衝撃波は出ない', g.shockwaves().length === 0);
  // ちびドッカーン取得後：ちび撃破から衝撃波が出る
  g.player.perks = { chick: 2, shock: 2, chickShock: 1 };
  const c2 = g.chickPositions()[0];
  g.enemies().length = 0;
  g.enemies().push({ type: 'seal', x: c2.x - 32, y: c2.y - 21, w: 64, h: 42, speed: 0, animTimer: 0, phase: 0 });
  g.update();
  check('ちびドッカーンでちび撃破から衝撃波が出る（範囲はLv2=210px）',
    g.shockwaves().length === 1 && g.shockwaves()[0].maxR === 210);
  for (let i = 0; i < 30; i++) g.update();  // リングを消化
}
g.player.perks = { glove: 1 };
{
  g.enemies().length = 0;
  g.enemies().push({ type: 'bird', x: g.player.x, y: g.player.y - 40, w: 52, h: 32, speed: 0, animTimer: 0, phase: 0 });
  g.player.vy = -8;  // 上昇中
  g.update();
  check('グローブパンチで頭上の敵を倒せる', g.enemies()[0].knocked === true);
  check('パンチドッカーン未取得ならパンチで衝撃波は出ない', g.shockwaves().length === 0);
  // パンチドッカーン取得後：パンチ撃破から衝撃波が出る
  g.player.perks = { glove: 1, shock: 1, punchShock: 1 };
  g.enemies().length = 0;
  g.enemies().push({ type: 'bird', x: g.player.x, y: g.player.y - 40, w: 52, h: 32, speed: 0, animTimer: 0, phase: 0 });
  g.player.vy = -8;
  g.update();
  check('パンチドッカーンでパンチ撃破から衝撃波が出る',
    g.shockwaves().length === 1 && g.shockwaves()[0].maxR === 150);
  for (let i = 0; i < 30; i++) g.update();  // リングを消化
  g.player.perks = { glove: 1 };
  // グローブの円より遠い敵には当たらない（見た目＝判定）
  g.enemies().length = 0;
  g.enemies().push({ type: 'bird', x: g.player.x, y: g.player.y - 100, w: 52, h: 32, speed: 0, animTimer: 0, phase: 0 });
  g.player.vy = -8;
  g.update();
  check('グローブの円の外の敵には当たらない', g.enemies()[0].knocked !== true);
  g.enemies().length = 0;
  g.enemies().push({ type: 'bird', x: g.player.x, y: g.player.y - 40, w: 52, h: 32, speed: 0, animTimer: 0, phase: 0 });
  g.player.vy = 3;   // 下降中はパンチしない
  g.player.invincible = 999999;
  g.update();
  check('下降中はグローブパンチが発動しない', g.enemies()[0].knocked !== true);
}

// ─ 4.8. ゴール：パワーアップ7個でゴールが予定され、クリアできる ─
g.startGame();
g.player.invincible = 99999999;
let choiceCount = 0;
let clearReached = false;
let goalPlannedAtLast = false;
for (let i = 0; i < 100000 && !clearReached; i++) {
  g.update();
  if (g.state() === g.STATE.PERK_CHOICE) {
    choiceCount++;
    g.onKeyDown('Digit1');
    if (choiceCount === 7 && g.goalDist() > 0) goalPlannedAtLast = true;
  }
  if (g.state() === g.STATE.CLEAR) clearReached = true;
}
check('7個目のパワーアップ取得でゴールが予定される', goalPlannedAtLast);
check('ゴールゲート通過でクリアになる', clearReached);
check('パーク選択はちょうど7回で打ち止め', choiceCount === 7);
const savedHigh = Number(localStorage.getItem('penguin_v2_highscore'));
check('クリア時点のスコアでハイスコアが保存される', savedHigh >= g.player.score && savedHigh > 0);
g.onKeyDown('Space');
check('クリア画面から Space でリトライできる', g.state() === g.STATE.PLAYING && g.perksTaken() === 0);

// ─ 5. 抽選プール：上限到達・条件付きパークが除外される ─
g.player.perks = { shock: 3, jump: 2, heartUp: 2, bounty: 3, magnet: 2, chick: 4, glove: 3, punchShock: 1, chickShock: 1 };
g.player.hp = g.maxHp();  // 満タンなので heal も提示不可
check('全取得＋満タンHPでは選択肢ゼロ', g.rollPerkChoices().length === 0);
g.player.hp = 1;
const healOnly = g.rollPerkChoices();
check('HPが減っていれば heal のみ提示', healOnly.length === 1 && healOnly[0].id === 'heal');

// ─ 6. 長時間プレイで例外が出ない（描画込み） ─
g.startGame();
g.player.perks = { shock: 2, magnet: 2, bounty: 1, chick: 2, glove: 1 };  // フック総動員
let error = null;
try {
  for (let i = 0; i < 30000; i++) {
    g.update();
    if (i % 97 === 0) g.draw();
    if (g.state() === g.STATE.PERK_CHOICE) {
      g.handlePointerDown(400, 200);  // タップで中央付近のカードを選択
      if (g.state() === g.STATE.PERK_CHOICE) g.onKeyDown('Space');  // 外れたらキーで確定
    }
    if (g.state() === g.STATE.GAMEOVER || g.state() === g.STATE.CLEAR) { g.onKeyDown('Space'); }   // リトライ
  }
} catch (e) { error = e; }
check('30000ティック駆動で例外なし', error === null);
if (error) console.error(error);

process.exit(failures > 0 ? 1 : 0);
