'use strict';

// ─── Canvas セットアップ ───────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const CANVAS_W = 800;  // 論理座標系の幅
const CANVAS_H = 450;  // 論理座標系の高さ

// 表示サイズ × devicePixelRatio で物理解像度を設定（ぼやけ防止）
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w;
    canvas.height = h;
  }
}
new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();

// ─── 定数 ────────────────────────────────────────────────────────────────────
const GRAVITY = 0.40;
const FALL_GRAVITY = 0.62;          // 落下時の重力（マリオ風：落下を速く）
const FLY_FALL_GRAVITY = 0.22;      // 飛行中の落下重力（ゆるやか）
const FALL_SMOOTH_VY = 3.5;         // この落下速度に達するまで通常重力を維持（頂点付近を浮かせる）
const GROUND_Y = CANVAS_H - 70;   // 地面の上端
const SCROLL_SPEED_INIT = 0.5;         // 開始時のスクロール速度
const SCROLL_SPEED_MAX = 4.0;         // 最大スクロール速度
const FLY_DURATION = 300;             // 飛行フレーム数（約5秒）
const PLAYER_SPEED = 5;
const JUMP_POWER = -11;
const STOMP_JUMP_POWER = -14;       // ストンプ後の大ジャンプ
const STOMP_JUMP_WINDOW = 14;       // 大ジャンプ受け付けフレーム数（ストンプ後）
const STOMP_JUMP_BUFFER = 8;        // 大ジャンプ先行入力フレーム数（ストンプ前）
const JUMP_CUT_VY = -4;             // 短押し時の上昇速度上限
const SHIELD_DURATION = FLY_DURATION;  // 無敵アイテムの持続フレーム数（飛行と同じ）
const PERK_FIRST_DIST = 4000;       // 最初のパーク選択までの走行距離（px）≒20秒
const PERK_INTERVAL_START = 6000;   // 2回目以降の選択間隔の初期値
const PERK_INTERVAL_GROWTH = 1300;  // 選択のたびに間隔を広げる量
const PERK_RESUME_GRACE = 50;       // パーク選択後の復帰無敵フレーム数
const PERK_CALM_TICKS = 300;        // ゲート到達前に敵スポーンを止める時間（スクロール距離に換算）
const PERK_POST_CALM = 150;         // パーク選択後に敵スポーンを再開するまでのフレーム数
const GOAL_PERKS = 7;               // この数のパワーアップを取るとゴールが予定される
const GOAL_AFTER_DIST = 12000;      // 最後のパワーアップ取得からゴールまでの距離（px）≒最高難易度で30秒強

// ─── ゲーム状態 ──────────────────────────────────────────────────────────────
const STATE = { TITLE: 0, PLAYING: 1, DYING: 2, GAMEOVER: 3, PERK_CHOICE: 4, CLEAR: 5 };
let state = STATE.TITLE;

// ─── 入力状態 ────────────────────────────────────────────────────────────────
const keys = {};
const virtualKeys = {};   // タッチ操作で使う仮想キー

window.addEventListener('keydown', e => {
  if (!keys[e.code]) {
    keys[e.code] = true;
    onKeyDown(e.code);
  }
  // スペースキーでページスクロール防止
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function isDown(code) {
  return !!(keys[code] || virtualKeys[code]);
}

// ─── タッチ操作（画面全体タップ） ────────────────────────────────────────────
document.addEventListener('touchstart', e => {
  e.preventDefault();
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const mx = (touch.clientX - rect.left) * (CANVAS_W / rect.width);
  const my = (touch.clientY - rect.top) * (CANVAS_H / rect.height);
  handlePointerDown(mx, my);
}, { passive: false });
document.addEventListener('touchend', e => { e.preventDefault(); virtualKeys['Space'] = false; }, { passive: false });
document.addEventListener('touchcancel', e => { e.preventDefault(); virtualKeys['Space'] = false; }, { passive: false });

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
  const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
  handlePointerDown(mx, my);
});
// マウスを離したら仮想ジャンプボタンを解除（touchend と同様。
// これがないとクリック後ずっと長押し扱いになり、常にハイジャンプになる）
window.addEventListener('mouseup', () => { virtualKeys['Space'] = false; });

function handlePointerDown(mx, my) {
  // タイトル画面：ハイスコアリセットボタン判定
  if (state === STATE.TITLE) {
    const bx = CANVAS_W / 2 + 6, by = 217, bw = 76, bh = 20;
    if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
      highScore = 0;
      localStorage.setItem('penguin_v2_highscore', '0');
      return;
    }
  }
  // パーク選択画面：カードのタップ判定（ジャンプ入力にはしない）
  if (state === STATE.PERK_CHOICE) {
    const rects = perkCardRects(perkChoices.length);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        acquirePerk(perkChoices[i]);
        break;
      }
    }
    return;
  }
  if (!virtualKeys['Space']) {
    virtualKeys['Space'] = true;
    onKeyDown('Space');
  }
}

// ─── プレイヤー ──────────────────────────────────────────────────────────────
const player = {
  x: 130, y: 0,
  w: 38, h: 50,
  vx: 0, vy: 0,
  facingRight: true,
  onGround: false,
  jumpCount: 0,
  stompBounceTimer: 0,
  jumpBuffer: 0,
  flying: false,
  flyTimer: 0,
  hp: 3,
  invincible: 0,
  shieldTimer: 0,
  deathTimer: 0,
  deathAngle: 0,
  animFrame: 0,
  animTimer: 0,
  score: 0,
  perks: {},
};

// ─── ゲームオブジェクト配列 ──────────────────────────────────────────────────
let enemies = [];
let powerups = [];
let particles = [];
let shockwaves = [];   // ストンプ衝撃波の広がるリング演出
let snowflakes = [];
let scorePopups = [];
let scrollX = 0;
let gameTime = 0;
let spawnTimer = 180;
let powerupTimer = 350;
let distAccum = 0;   // 距離スコア用の端数管理
let airCombo = 0;    // 空中連続撃破コンボ数
let sealStreak = 0;  // 連続アザラシスポーン数（鳥の出現確率調整に使用）
let currentScrollSpeed = SCROLL_SPEED_INIT;
let highScore = parseInt(localStorage.getItem('penguin_v2_highscore') || '0', 10);
let nextPerkDist = PERK_FIRST_DIST;   // 次のパーク選択が発生する走行距離
let perkInterval = PERK_INTERVAL_START;
let perkChoices = [];                 // 現在提示中のパーク（最大3つ）
let perkCursor = 1;                   // キーボード選択カーソル
let perkUiTime = 0;                   // 選択画面の点滅アニメ用（gameTimeは止める）
let perkGate = null;                  // パワーアップゲート（くぐるとパーク選択）
let postPerkCalm = 0;                 // 選択後の敵スポーン停止タイマー
let perksTaken = 0;                   // 取得したパワーアップの総数（ゴール判定用）
let goalDist = 0;                     // ゴールが出現する走行距離（0 = 未予定）
let goalGate = null;                  // ゴールゲート（くぐるとクリア）

// ─── パーク（ローグライト強化）──────────────────────────────────────────────
const PERK_COLOR = '#9ad6ff';   // カード・チップ共通のアクセント色

const PERKS = [
  {
    id: 'shock', name: 'ふみつけドッカーン', max: 3,
    desc: ['ふみつけたとき', 'まわりのてきも ドカーンと', 'ふきとばす'],
  },
  {
    id: 'jump', name: 'もう1かいジャンプ', max: 2,
    desc: ['そらでとべるかいすうが', '1かい ふえる'],
  },
  {
    id: 'heartUp', name: 'おおきなハート', max: 2,
    desc: ['ハートが 1こ ふえて', '1こ かいふくする'],
    onAcquire() { player.hp = Math.min(player.hp + 1, maxHp()); },
  },
  {
    id: 'bounty', name: 'やっつけボーナス', max: 3,
    desc: ['てきをたおしたときの', 'スコアが ふえる'],
  },
  {
    id: 'magnet', name: 'マグネット', max: 2,
    desc: ['アイテムが じぶんのほうに', 'とんでくる'],
  },
  {
    id: 'chick', name: 'ちびペンギン', max: 4,
    desc: ['こペンギンが まわって', 'てきを たおしてくれる', '（Lvで なかまが ふえる）'],
  },
  {
    id: 'glove', name: 'パンチグローブ', max: 3,
    desc: ['ジャンプちゅう あたまの', 'うえのてきを パンチ！', '（Lvで グローブがおおきく）'],
  },
  {
    // かくしパーク：ドッカーンとグローブの両方を持っていると4枚目として出現する
    id: 'punchShock', name: 'パンチドッカーン', max: 1, hidden: true,
    desc: ['パンチでてきをたおすと', 'そこからドッカーンがでる'],
    canOffer: () => perkLevel('shock') > 0 && perkLevel('glove') > 0,
  },
  {
    // かくしパーク：ドッカーンとちびペンギンの両方を持っていると4枚目として出現する
    id: 'chickShock', name: 'ちびドッカーン', max: 1, hidden: true,
    desc: ['ちびペンギンがたおすと', 'そこからドッカーンがでる'],
    canOffer: () => perkLevel('shock') > 0 && perkLevel('chick') > 0,
  },
  {
    id: 'heal', name: 'げんきのさかな', max: 99, instant: true,
    desc: ['ハートが 1こ かいふく'],
    canOffer: () => player.hp < maxHp(),
    onAcquire() { player.hp = Math.min(player.hp + 1, maxHp()); },
  },
];

function perkLevel(id) { return player.perks[id] || 0; }
function maxHp() { return 3 + perkLevel('heartUp'); }
function maxAirJumps() { return 2 + perkLevel('jump'); }

// 敵撃破スコア（コンボ・ハンターを反映した最終値）
function enemyPts(e, comboMult) {
  const base = getEnemyScore(e) * comboMult;
  return Math.round(base * (1 + 0.5 * perkLevel('bounty')));
}

// 取得済み（強化中）のパークは少し選ばれやすくする重み（未取得は1）
const PERK_OWNED_WEIGHT = 2;

function perkWeight(p) {
  return (!p.instant && perkLevel(p.id) > 0) ? PERK_OWNED_WEIGHT : 1;
}

// 通常パークから3つ抽選（取得上限・提示条件を満たすものから重み付き・重複なし）。
// かくしパークは条件が揃っていれば3つとは別に1枚追加で提示する
function rollPerkChoices() {
  const pool = PERKS.filter(p => !p.hidden && perkLevel(p.id) < p.max && (!p.canOffer || p.canOffer()));
  const picks = [];
  while (pool.length > 0 && picks.length < 3) {
    const total = pool.reduce((s, p) => s + perkWeight(p), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= perkWeight(pool[idx]);
      if (r <= 0) break;
    }
    picks.push(pool[idx]);
    pool.splice(idx, 1);
  }
  const hidden = PERKS.filter(p => p.hidden && perkLevel(p.id) < p.max && p.canOffer());
  if (hidden.length > 0) {
    picks.push(hidden[Math.floor(Math.random() * hidden.length)]);
  }
  return picks;
}

function acquirePerk(perk) {
  if (!perk) return;
  player.perks[perk.id] = perkLevel(perk.id) + 1;
  if (perk.onAcquire) perk.onAcquire();
  perksTaken++;
  // 規定数のパワーアップを取ったら、しばらく先にゴールを予定する
  if (perksTaken >= GOAL_PERKS && goalDist === 0) {
    goalDist = scrollX + GOAL_AFTER_DIST;
  }
  burst(player.x + player.w / 2, player.y + player.h / 2, PERK_COLOR, 18);
  player.invincible = Math.max(player.invincible, PERK_RESUME_GRACE);
  state = STATE.PLAYING;
}

// パーク選択カードのレイアウト（当たり判定と描画で共有）
// かくしパーク込みで4枚になるときは少し詰めて並べる
function perkCardRects(count) {
  const w = count >= 4 ? 168 : 190;
  const h = 235;
  const gap = count >= 4 ? 22 : 28;
  const totalW = count * w + (count - 1) * gap;
  const x0 = (CANVAS_W - totalW) / 2;
  const y = 128;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), y, w, h }));
}

// ─── ゲームリセット ──────────────────────────────────────────────────────────
function startGame() {
  Object.assign(player, {
    x: 130, y: GROUND_Y - 50,
    vx: 0, vy: 0,
    facingRight: true,
    onGround: true,
    jumpCount: 0,
    stompBounceTimer: 0,
    jumpBuffer: 0,
    flying: false,
    flyTimer: 0,
    hp: 3,
    invincible: 0,
    shieldTimer: 0,
    deathTimer: 0,
    deathAngle: 0,
    animFrame: 0,
    animTimer: 0,
    score: 0,
    perks: {},
  });
  enemies = [];
  powerups = [];
  particles = [];
  shockwaves = [];
  scorePopups = [];
  scrollX = 0;
  gameTime = 0;
  spawnTimer = 180;
  powerupTimer = 350;
  distAccum = 0;
  airCombo = 0;
  sealStreak = 0;
  currentScrollSpeed = SCROLL_SPEED_INIT;
  nextPerkDist = PERK_FIRST_DIST;
  perkInterval = PERK_INTERVAL_START;
  perkChoices = [];
  perkCursor = 1;
  perkGate = null;
  postPerkCalm = 0;
  perksTaken = 0;
  goalDist = 0;
  goalGate = null;
  initSnowflakes();
  state = STATE.PLAYING;
}

function initSnowflakes() {
  snowflakes = [];
  for (let i = 0; i < 70; i++) {
    snowflakes.push(makeSnowflake(Math.random() * CANVAS_W));
  }
}

function makeSnowflake(startX) {
  return {
    x: startX,
    y: Math.random() * CANVAS_H,
    r: Math.random() * 2.5 + 0.8,
    speed: Math.random() * 1.2 + 0.4,
    drift: (Math.random() - 0.5) * 0.5,
  };
}

// ─── キー押し下げハンドラ ────────────────────────────────────────────────────
function onKeyDown(code) {
  if (state === STATE.TITLE || state === STATE.GAMEOVER || state === STATE.CLEAR) {
    if (code === 'Space') startGame();
    return;
  }
  // パーク選択：数字キーで即決定、←→＋Space/Enterでも選べる
  if (state === STATE.PERK_CHOICE) {
    if (code === 'Digit1' || code === 'Numpad1') acquirePerk(perkChoices[0]);
    else if (code === 'Digit2' || code === 'Numpad2') acquirePerk(perkChoices[1]);
    else if (code === 'Digit3' || code === 'Numpad3') acquirePerk(perkChoices[2]);
    else if (code === 'Digit4' || code === 'Numpad4') acquirePerk(perkChoices[3]);
    else if (code === 'ArrowLeft') perkCursor = (perkCursor + perkChoices.length - 1) % perkChoices.length;
    else if (code === 'ArrowRight') perkCursor = (perkCursor + 1) % perkChoices.length;
    else if (code === 'Space' || code === 'Enter') acquirePerk(perkChoices[perkCursor]);
    return;
  }
  if (state !== STATE.PLAYING) return;

  // ジャンプ（Space のみ）
  if (code === 'Space') {
    player.jumpBuffer = STOMP_JUMP_BUFFER;  // 先行入力を記録
    if (player.stompBounceTimer > 0) {
      // ストンプ後の大ジャンプ
      player.vy = STOMP_JUMP_POWER;
      player.stompBounceTimer = 0;
      player.jumpCount = 1;
      player.onGround = false;
    } else if (player.flying || player.jumpCount < maxAirJumps()) {
      player.vy = JUMP_POWER * (player.jumpCount >= 1 && !player.flying ? 0.85 : 1);
      if (!player.flying) player.jumpCount++;
      player.onGround = false;
    }
  }
}


// ─── メイン更新 ──────────────────────────────────────────────────────────────
function update() {
  if (state === STATE.DYING) {
    gameTime++;
    player.deathTimer--;
    player.deathAngle = Math.min(player.deathAngle + 0.055, Math.PI / 2);
    player.vy += player.vy > 0 ? FALL_GRAVITY : GRAVITY;
    player.y += player.vy;
    const gnd = GROUND_Y - player.h;
    if (player.y >= gnd) { player.y = gnd; player.vy = 0; }
    updateParticles();
    updateShockwaves();
    updateScorePopups();
    snowflakes.forEach(s => moveSnowflake(s));
    if (player.deathTimer <= 0) {
      if (player.score > highScore) {
        highScore = player.score;
        localStorage.setItem('penguin_v2_highscore', highScore.toString());
      }
      state = STATE.GAMEOVER;
    }
    return;
  }

  // パーク選択中：ゲームは完全停止（gameTimeも止めて難易度が進まないようにする）
  if (state === STATE.PERK_CHOICE) {
    perkUiTime++;
    snowflakes.forEach(s => moveSnowflake(s));
    return;
  }

  if (state !== STATE.PLAYING) {
    // タイトル時も雪を動かす
    snowflakes.forEach(s => moveSnowflake(s));
    gameTime++;
    // クリア画面：紙吹雪のお祝い
    if (state === STATE.CLEAR) {
      updateParticles();
      if (gameTime % 22 === 0) {
        const colors = ['#ffd700', '#ff6688', '#66ddff', '#88ee66', '#ffaa44'];
        burst(60 + Math.random() * (CANVAS_W - 120), 40 + Math.random() * 160,
          colors[Math.floor(Math.random() * colors.length)], 10);
      }
    }
    return;
  }

  gameTime++;
  // gameTimeに応じてスクロール速度を徐々に上げる
  currentScrollSpeed = Math.min(SCROLL_SPEED_INIT + gameTime / 500, SCROLL_SPEED_MAX);
  scrollX += currentScrollSpeed;

  // 距離に応じてスコア加算（10ピクセルごとに1点）
  distAccum += currentScrollSpeed;
  const distPts = Math.floor(distAccum / 10);
  if (distPts > 0) {
    player.score += distPts;
    distAccum -= distPts * 10;
  }

  updatePlayer();

  updateEnemies();
  updatePowerups();
  updateParticles();
  updateShockwaves();
  updateScorePopups();
  snowflakes.forEach(s => moveSnowflake(s));
  checkCollisions();

  // パークゲート：一定距離でゲートが出現し、くぐるとパーク選択（ゴール予定後は出ない）
  if (!perkGate && goalDist === 0 && scrollX >= nextPerkDist) {
    if (rollPerkChoices().length > 0) {
      perkGate = { x: CANVAS_W + 80 };
    } else {
      // 提示できるパークがない（全取得など）：次の機会へ先送り
      nextPerkDist += perkInterval;
      perkInterval += PERK_INTERVAL_GROWTH;
    }
  }
  if (perkGate) {
    perkGate.x -= currentScrollSpeed;
    if (perkGate.x < player.x + player.w / 2) {
      // 通過：画面に残った敵は吹き飛ばして場を空ける（スコアなし）
      enemies.forEach(e => { if (!e.knocked) knockEnemy(e); });
      perkGate = null;
      postPerkCalm = PERK_POST_CALM;
      nextPerkDist += perkInterval;
      perkInterval += PERK_INTERVAL_GROWTH;
      const picks = rollPerkChoices();
      if (picks.length > 0) {
        perkChoices = picks;
        perkCursor = Math.min(1, picks.length - 1);
        perkUiTime = 0;
        state = STATE.PERK_CHOICE;
      }
    }
  }

  // ゴール：規定数のパワーアップ取得後、しばらく走るとゴールゲートが来る
  if (goalDist > 0 && !goalGate && scrollX >= goalDist) {
    goalGate = { x: CANVAS_W + 80 };
  }
  if (goalGate) {
    goalGate.x -= currentScrollSpeed;
    if (goalGate.x < player.x + player.w / 2) {
      // ゴール！この時点のスコアでハイスコアを記録
      if (player.score > highScore) {
        highScore = player.score;
        localStorage.setItem('penguin_v2_highscore', highScore.toString());
      }
      burst(player.x + player.w / 2, player.y + player.h / 2, '#ffd700', 30);
      state = STATE.CLEAR;
      return;
    }
  }

  // ゲート・ゴール接近中〜選択直後は敵スポーンを止めて安全地帯にする
  if (postPerkCalm > 0) postPerkCalm--;
  const gateAhead = perkGate !== null || goalGate !== null ||
    (goalDist > 0 && scrollX >= goalDist - currentScrollSpeed * PERK_CALM_TICKS) ||
    (goalDist === 0 && scrollX >= nextPerkDist - currentScrollSpeed * PERK_CALM_TICKS);
  const calmZone = gateAhead || postPerkCalm > 0;

  // スポーン
  spawnTimer--;
  if (spawnTimer <= 0 && !calmZone) {
    spawnEnemy();
    // 中盤から2体同時スポーンの確率を追加（gameTime>4500 からゲート7までかけて最大25%）
    if (gameTime > 4500 && Math.random() < Math.min((gameTime - 4500) / 36000, 0.25)) {
      spawnEnemy();
    }
    // なだらかな指数カーブで出現間隔を短縮（ゲートごとに約1.35倍のペースアップ、最小25フレーム）
    const interval = Math.max(25, Math.round(25 + 165 * Math.exp(-gameTime / 4200)));
    spawnTimer = interval + Math.floor(Math.random() * (gameTime > 5000 ? 10 : 20));
  }
  // アイテムはゲート・ゴールの直前には出さない（取っても選択画面までに活かせないため）
  powerupTimer--;
  if (powerupTimer <= 0 && !gateAhead) {
    spawnPowerup();
    powerupTimer = 380 + Math.floor(Math.random() * 200);
  }
}

function updatePlayer() {
  // 無限ジャンプ中
  if (player.flying) {
    player.flyTimer--;
    if (player.flyTimer <= 0) {
      player.flying = false;
    }
  }

  // 重力（落下初速はゆるやか、加速後は重く：飛行中はさらにゆるやか）
  const fallG = player.flying ? FLY_FALL_GRAVITY : FALL_GRAVITY;
  player.vy += player.vy > FALL_SMOOTH_VY ? fallG : GRAVITY;

  // ジャンプキーを離したら上昇をカット
  if (player.vy < JUMP_CUT_VY && !isDown('Space')) {
    player.vy = JUMP_CUT_VY;
  }

  player.x += player.vx;
  player.y += player.vy;

  // X クランプ
  if (player.x < 20) { player.x = 20; player.vx = 0; }
  if (player.x > CANVAS_W - player.w - 20) { player.x = CANVAS_W - player.w - 20; player.vx = 0; }

  // 天井
  if (player.y < 5) { player.y = 5; player.vy = 0; }

  // 地面
  const gnd = GROUND_Y - player.h;
  if (player.y >= gnd) {
    player.y = gnd;
    player.vy = 0;
    player.onGround = true;
    player.jumpCount = 0;
    airCombo = 0;
  } else {
    player.onGround = false;
  }

  // クールダウン
  if (player.invincible > 0) player.invincible--;
  if (player.shieldTimer > 0) player.shieldTimer--;
  if (player.stompBounceTimer > 0) player.stompBounceTimer--;
  if (player.jumpBuffer > 0) player.jumpBuffer--;

  // アニメーション
  player.animTimer++;
  if (player.animTimer >= 8) {
    player.animTimer = 0;
    player.animFrame = (player.animFrame + 1) % 4;
  }
}


function updateEnemies() {
  // 敵の追加速度はゲート3過ぎ（gameTime≒6000）まで時間をかけて上がる
  const speed = currentScrollSpeed + 0.5 + Math.min(gameTime / 3000, 2);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.knocked) {
      e.vy += 0.45;
      e.x += e.vx;
      e.y += e.vy;
      e.rotation += e.rotSpeed;
      if (e.y > CANVAS_H + 120 || e.x < -200 || e.x > CANVAS_W + 200) {
        enemies.splice(i, 1);
      }
      continue;
    }
    e.x -= e.speed + speed * 0.4;
    e.animTimer = (e.animTimer + 1) % 20;

    if (e.type === 'bird') {
      e.y += Math.sin(gameTime * 0.055 + e.phase) * 0.7;
    } else if (e.type === 'diveBird') {
      // 大きく上下に動く鳥
      e.y += Math.sin(gameTime * 0.04 + e.phase) * e.amplitude;
    } else if (e.type === 'seal' && e.jumping) {
      // ジャンプするアザラシ
      e.jumpTimer--;
      if (e.jumpTimer <= 0 && e.onGround) {
        e.vy = e.jumpPower;
        e.onGround = false;
      }
      if (!e.onGround) {
        e.vy += 0.35;
        e.y += e.vy;
        const gnd = GROUND_Y - e.h;
        if (e.y >= gnd) {
          e.y = gnd;
          e.vy = 0;
          e.onGround = true;
          // 次のジャンプまでのタイマーをリセット
          e.jumpTimer = e.jumpInterval + Math.floor(Math.random() * 30);
        }
      }
    }
    if (e.x < -120) enemies.splice(i, 1);
  }
}

function updatePowerups() {
  const magLv = perkLevel('magnet');
  const pcx = player.x + player.w / 2;
  const pcy = player.y + player.h / 2;
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.x -= currentScrollSpeed + 0.5;
    // マグネット：近くのアイテムをプレイヤーへ引き寄せる
    if (magLv > 0) {
      const dx = pcx - p.x, dy = pcy - p.y;
      const d = Math.hypot(dx, dy);
      const radius = 130 + 80 * magLv;
      if (d > 0 && d < radius) {
        const pull = (1 - d / radius) * (2.5 + magLv);
        p.x += dx / d * pull;
        p.y += dy / d * pull;
      }
    }
    if (p.x < -60) powerups.splice(i, 1);
  }
}

const SHOCKWAVE_LIFE = 24;  // 衝撃波リングの表示フレーム数

// 現在のリング半径（判定と描画で共有して、見た目＝当たり判定を保証する）
function shockwaveRadius(s) {
  const t = s.life / SHOCKWAVE_LIFE;
  return Math.max(1, s.maxR * (1 - Math.pow(1 - t, 3)));  // 最初に勢いよく広がる
}

// 円と矩形の重なり（矩形上の最近接点との距離で判定）
function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

function updateShockwaves() {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.life++;
    // リングの広がりに合わせて毎フレーム判定：触れた敵をその場で吹き飛ばす
    if (state === STATE.PLAYING) {
      const r = shockwaveRadius(s);
      for (const e of enemies) {
        if (e.knocked) continue;
        if (circleRectOverlap(s.x, s.y, r, e.x + 4, e.y + 4, e.w - 8, e.h - 8)) {
          knockEnemy(e);
          let m = 1;
          if (!player.onGround) { airCombo++; m = getComboMultiplier(airCombo); }
          const pts = enemyPts(e, m);
          burst(e.x + e.w / 2, e.y + e.h / 2, '#ffcc66', 10);
          addScorePopup(e.x + e.w / 2, e.y, pts, '#ffcc66', m);
          player.score += pts;
        }
      }
    }
    if (s.life >= SHOCKWAVE_LIFE) shockwaves.splice(i, 1);
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.25;
    p.vx *= 0.95;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function moveSnowflake(s) {
  s.x += s.drift - currentScrollSpeed * 0.15;
  s.y += s.speed;
  if (s.y > CANVAS_H + 5) { s.y = -5; s.x = Math.random() * CANVAS_W; }
  if (s.x < -5) s.x = CANVAS_W + 5;
}

// ─── 衝突判定 ────────────────────────────────────────────────────────────────
function getComboMultiplier(combo) {
  if (combo >= 6) return 4;
  if (combo >= 4) return 3;
  if (combo >= 2) return 2;
  return 1;
}

function getEnemyScore(e) {
  if (e.type === 'diveBird') return 500;
  if (e.type === 'bird') return 300;
  // seal
  if (e.jumping && e.fast) return 400;
  if (e.jumping) return 200;
  if (e.fast) return 200;
  return 100;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ちびペンギンの現在位置（プレイヤー中心の円軌道、レベル数だけ等間隔）
function chickPositions() {
  const n = perkLevel('chick');
  if (n === 0) return [];
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const base = gameTime * 0.045;
  const radius = 85;
  return Array.from({ length: n }, (_, i) => {
    const a = base + (Math.PI * 2 / n) * i;
    return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, angle: a };
  });
}

// ─ パンチグローブ：描画と当たり判定で同じ位置・大きさを共有する ─
const GLOVE_ANGLE = 0.25;    // 腕の傾き（ラジアン）
const GLOVE_ARM_LEN = 31;    // 肩からグローブ中心までの長さ

function gloveRadius() { return 7 + 5 * perkLevel('glove'); }  // Lv1:12 / Lv2:17 / Lv3:22

function gloveThrust() {
  return player.vy < -2 ? 3 + Math.sin(gameTime * 0.6) * 2 : 0;  // 上昇中は突き続ける
}

// グローブ中心のワールド座標（描画の transform と同じ計算）
function gloveCenter() {
  const lx = 13 + Math.sin(GLOVE_ANGLE) * GLOVE_ARM_LEN;
  const ly = -2 - gloveThrust() - Math.cos(GLOVE_ANGLE) * GLOVE_ARM_LEN;
  return {
    x: player.x + player.w / 2 + (player.facingRight ? lx : -lx),
    y: player.y + player.h / 2 + ly,
  };
}

// 敵を吹き飛ばす（プレイヤーから遠ざかる方向へ）
function knockEnemy(e) {
  const dir = e.x + e.w / 2 > player.x + player.w / 2 ? 1 : -1;
  e.knocked = true;
  e.vx = dir * (3 + Math.random() * 2);
  e.vy = -(4 + Math.random() * 3);
  e.rotation = 0;
  e.rotSpeed = (0.12 + Math.random() * 0.15) * dir;
}

function checkCollisions() {

  // 無敵時は1.25倍の当たり判定
  const hitScale = player.shieldTimer > 0 ? 1.25 : 1.0;
  const phw = player.w * hitScale;
  const phh = player.h * hitScale;
  const phx = player.x + (player.w - phw) / 2;
  const phy = player.y + (player.h - phh) / 2;

  // ストンプ（上から踏みつけ）
  for (let ei = enemies.length - 1; ei >= 0; ei--) {
    const e = enemies[ei];
    if (e.knocked) continue;
    const hOverlap = phx + phw - 8 > e.x - 8 && phx + 8 < e.x + e.w + 8;
    const playerBottom = phy + phh;
    const stomping = player.vy > 0 && playerBottom >= e.y - 10 && playerBottom <= e.y + e.h * 0.45;
    if (hOverlap && stomping) {
      knockEnemy(e);
      airCombo++;
      const comboMult = getComboMultiplier(airCombo);
      const pts = enemyPts(e, comboMult);
      burst(e.x + e.w / 2, e.y + e.h / 2, '#aaddff', 12);
      addScorePopup(e.x + e.w / 2, e.y, pts, '#aaddff', comboMult);
      player.score += pts;

      // ストンプ衝撃波：広がるリングが当たり判定そのもの（updateShockwavesで毎フレーム判定）
      const shockLv = perkLevel('shock');
      if (shockLv > 0) {
        shockwaves.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, maxR: 90 + 60 * shockLv, life: 0 });
      }
      player.vy = -5;  // 小さく弾む
      player.jumpCount = 0;
      if (isDown('Space') || player.jumpBuffer > 0) {
        // 長押し中または先行入力あり：即座に大ジャンプ
        player.vy = STOMP_JUMP_POWER;
        player.jumpCount = 1;
        player.jumpBuffer = 0;
      } else {
        player.stompBounceTimer = STOMP_JUMP_WINDOW;
        burst(player.x + player.w / 2, player.y + player.h / 2, '#ffaa00', 14);
      }
      break;
    }
  }

  // シールド中のプレイヤー vs 敵（ノックバック）
  if (player.shieldTimer > 0) {
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (e.knocked) continue;
      if (rectsOverlap(phx + 4, phy + 4, phw - 8, phh - 8,
        e.x + 4, e.y + 4, e.w - 8, e.h - 8)) {
        knockEnemy(e);
        burst(e.x + e.w / 2, e.y + e.h / 2, '#ffd700', 12);
        let shieldMult = 1;
        if (!player.onGround) { airCombo++; shieldMult = getComboMultiplier(airCombo); }
        const shieldPts = enemyPts(e, shieldMult);
        addScorePopup(e.x + e.w / 2, e.y, shieldPts, '#ffd700', shieldMult);
        player.score += shieldPts;
      }
    }
  }

  // ちびペンギン vs 敵（触れた敵を吹き飛ばす。空中ならコンボに乗る）
  for (const c of chickPositions()) {
    for (const e of enemies) {
      if (e.knocked) continue;
      if (rectsOverlap(c.x - 13, c.y - 13, 26, 26,
        e.x + 4, e.y + 4, e.w - 8, e.h - 8)) {
        knockEnemy(e);
        let m = 1;
        if (!player.onGround) { airCombo++; m = getComboMultiplier(airCombo); }
        const pts = enemyPts(e, m);
        burst(e.x + e.w / 2, e.y + e.h / 2, '#ffaa66', 12);
        addScorePopup(e.x + e.w / 2, e.y, pts, '#ffaa66', m);
        player.score += pts;
        // かくしパーク「ちびドッカーン」：ちび撃破からも衝撃波（範囲はドッカーンのLv連動）
        if (perkLevel('chickShock') > 0) {
          shockwaves.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, maxR: 90 + 60 * perkLevel('shock'), life: 0 });
        }
      }
    }
  }

  // グローブパンチ：ジャンプ上昇中、見えているグローブの円がそのまま当たり判定
  if (perkLevel('glove') > 0 && player.vy < -2) {
    const gp = gloveCenter();
    const gr = gloveRadius();
    for (const e of enemies) {
      if (e.knocked) continue;
      if (circleRectOverlap(gp.x, gp.y, gr, e.x + 4, e.y + 4, e.w - 8, e.h - 8)) {
        knockEnemy(e);
        airCombo++;
        const m = getComboMultiplier(airCombo);
        const pts = enemyPts(e, m);
        burst(e.x + e.w / 2, e.y + e.h / 2, '#ff6677', 14);
        addScorePopup(e.x + e.w / 2, e.y, pts, '#ff6677', m);
        player.score += pts;
        // かくしパーク「パンチドッカーン」：パンチ撃破からも衝撃波（範囲はドッカーンのLv連動）
        if (perkLevel('punchShock') > 0) {
          shockwaves.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, maxR: 90 + 60 * perkLevel('shock'), life: 0 });
        }
      }
    }
  }

  // プレイヤー vs 敵
  if (player.invincible === 0 && player.shieldTimer === 0) {
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (e.knocked) continue;
      if (rectsOverlap(player.x + 6, player.y + 6, player.w - 12, player.h - 10,
        e.x + 4, e.y + 4, e.w - 8, e.h - 8)) {
        if (player.flying) {
          // 無限ジャンプ中は状態解除・弾かれる（HPダメージなし）
          player.flying = false;
          player.vy = 5;
          player.invincible = 60;
          burst(player.x + player.w / 2, player.y + player.h / 2, '#ffaa44', 10);
        } else {
          player.hp--;
          player.invincible = 90;
          burst(player.x + player.w / 2, player.y + player.h / 2, '#ff8888', 12);
          enemies.splice(ei, 1);
          if (player.hp <= 0) {
            state = STATE.DYING;
            player.deathTimer = 130;
            player.vy = -5;
          }
        }
        break;
      }
    }
  }

  // プレイヤー vs パワーアップ
  for (let pi = powerups.length - 1; pi >= 0; pi--) {
    const p = powerups[pi];
    if (rectsOverlap(phx + 4, phy + 4, phw - 8, phh - 8,
      p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)) {
      if (p.type === 'heart') {
        player.hp = Math.min(player.hp + 1, maxHp());
        burst(p.x, p.y, '#ff3355', 18);
        addScorePopup(p.x, p.y - p.r, 100, '#ff88aa');
        player.score += 100;
      } else if (p.type === 'star') {
        player.score += 1000;
        burst(p.x, p.y, '#ffdd00', 24);
        addScorePopup(p.x, p.y - p.r, 1000, '#ffdd00');
      } else if (p.type === 'shield') {
        player.shieldTimer = SHIELD_DURATION;
        burst(p.x, p.y, '#ffd700', 24);
        addScorePopup(p.x, p.y - p.r, 200, '#ffd700');
        player.score += 200;
      } else {
        // fish（無限ジャンプ）
        player.flying = true;
        player.flyTimer = FLY_DURATION;
        player.vy = JUMP_POWER;  // 取った瞬間にジャンプ
        player.jumpCount = 0;
        burst(p.x, p.y, '#ffee66', 18);
        addScorePopup(p.x, p.y - p.r, 500, '#55ddff');
        player.score += 500;
      }
      powerups.splice(pi, 1);
    }
  }
}

// ─── スポーン ────────────────────────────────────────────────────────────────
function spawnEnemy() {
  const baseSpeed = 0.3 + Math.min(gameTime / 2400, 2.0);

  // 時間経過で強化バリアントの出現確率が上がる
  // （立ち上がりを引き伸ばし、ゲート1〜3の各区間で段階的に強くなるように）
  const jumpSealChance = gameTime > 1500 ? Math.min(Math.sqrt((gameTime - 1500) / 8000), 0.60) : 0;
  const diveBirdChance = gameTime > 1000 ? Math.min(Math.sqrt((gameTime - 1000) / 9000), 0.55) : 0;

  // 連続アザラシの後は鳥が出やすくなる（1連続:+18%、2連続:+36%、3連続以上:+50%）
  const birdChance = Math.min(0.42 + sealStreak * 0.18, 0.75);
  const roll = Math.random();

  if (roll < birdChance) {
    // 鳥系
    sealStreak = 0;  // 鳥が出たらストリークリセット
    if (Math.random() < diveBirdChance) {
      // 大きく上下に動く鳥
      enemies.push({
        type: 'diveBird',
        x: CANVAS_W + 60,
        y: 100 + Math.random() * 100,
        w: 52, h: 32,
        speed: baseSpeed + Math.random() * 1.5,
        animTimer: 0,
        phase: Math.random() * Math.PI * 2,
        amplitude: 1.8 + Math.random() * 1.0,  // 通常の0.7に対して1.8〜2.8
      });
    } else {
      // 通常の鳥
      enemies.push({
        type: 'bird',
        x: CANVAS_W + 60,
        y: 60 + Math.random() * 160,
        w: 52, h: 32,
        speed: baseSpeed + Math.random() * 1.5,
        animTimer: 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
  } else {
    sealStreak++;  // アザラシが出たらストリーク加算
    // アザラシ系
    // 高速種はゲート2手前（gameTime>2000）からゲート6までかけて上昇（最大45%）
    const fastChance = gameTime > 2000 ? Math.min((gameTime - 2000) / 18000, 0.45) : 0;
    const isFast = Math.random() < fastChance;
    const sealSpeed = isFast
      ? baseSpeed + 1.8 + Math.random() * 1.0
      : baseSpeed + 0.7 + Math.random() * 1.0;

    if (Math.random() < jumpSealChance) {
      // ジャンプするアザラシ（時間経過で高いジャンプが解放される）
      const jumpLevels = [-6];                      // 序盤：低ジャンプのみ
      if (gameTime > 2500) jumpLevels.push(-9);     // 中盤：中ジャンプ追加
      if (gameTime > 4500) jumpLevels.push(-12);    // 終盤：高ジャンプ追加
      const jumpPower = jumpLevels[Math.floor(Math.random() * jumpLevels.length)];
      const interval = Math.max(40, 80 - Math.floor(gameTime / 600) * 5);
      enemies.push({
        type: 'seal',
        x: CANVAS_W + 60,
        y: GROUND_Y - 42,
        w: 64, h: 42,
        speed: sealSpeed,
        animTimer: 0,
        phase: 0,
        fast: isFast,
        jumping: true,
        jumpPower,
        jumpInterval: interval,
        jumpTimer: 20 + Math.floor(Math.random() * 40),
        vy: 0,
        onGround: true,
      });
    } else {
      // 通常のアザラシ
      enemies.push({
        type: 'seal',
        x: CANVAS_W + 60,
        y: GROUND_Y - 42,
        w: 64, h: 42,
        speed: sealSpeed,
        animTimer: 0,
        phase: 0,
        fast: isFast,
      });
    }
  }
}

function spawnPowerup() {
  let types = ['fish', 'heart', 'star', 'shield'];
  if (player.shieldTimer > 0) types = types.filter(t => t !== 'shield');
  if (player.flying) types = types.filter(t => t !== 'fish');
  const type = types[Math.floor(Math.random() * types.length)];
  powerups.push({
    type,
    x: CANVAS_W + 60,
    y: GROUND_Y - 70 - Math.random() * 120,
    r: 22,
  });
}

function drawStompJumpEffect() {
  if (player.stompBounceTimer <= 0) return;
  const remaining = player.stompBounceTimer / STOMP_JUMP_WINDOW;  // 1→0
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;

  ctx.save();
  for (let i = 0; i < 3; i++) {
    const phase = (gameTime * 0.09 + i * 0.33) % 1;   // 0→1 を各リングでずらして循環
    const radius = 16 + phase * 34;
    const alpha  = (1 - phase) * remaining * 0.9;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = '#ff8800';
    ctx.shadowBlur  = 14;
    ctx.strokeStyle = phase < 0.45 ? '#ffee44' : '#ff7700';
    ctx.lineWidth   = 3 - phase * 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function addScorePopup(x, y, pts, color = '#ffee44', multiplier = 1) {
  const vyTable = [0, -1.6, -2.0, -2.5, -3.0];
  scorePopups.push({ x, y, pts, text: `+${pts}`, color, life: 75, maxLife: 75, vy: vyTable[multiplier] ?? -1.6, multiplier });
}

function updateScorePopups() {
  for (let i = scorePopups.length - 1; i >= 0; i--) {
    const p = scorePopups[i];
    p.y += p.vy;
    p.vy *= 0.96;
    p.life--;
    if (p.life <= 0) scorePopups.splice(i, 1);
  }
}

function drawScorePopups() {
  scorePopups.forEach(p => {
    const alpha = p.life / p.maxLife;
    const m = p.multiplier ?? 1;
    const elapsed = p.maxLife - p.life;

    // ポップアニメーション：最初の12フレームで縮小
    const popProgress = Math.min(1, elapsed / 12);
    const popScale = 1 + (m - 1) * 0.45 * (1 - popProgress);

    // x4 は左右に揺れる
    const wobble = m >= 4 ? Math.sin(elapsed * 0.6) * 4 : 0;

    const baseSizes = [0, 18, 22, 28, 36];
    const size = Math.round((baseSizes[m] ?? 18) * popScale);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = `bold ${size}px Arial`;

    // x3以上はグロー
    if (m >= 3) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = m >= 4 ? 22 : 12;
    }

    ctx.lineWidth = m >= 3 ? 5 : 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(p.text, p.x + wobble, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x + wobble, p.y);
    ctx.restore();
  });
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = Math.random() * 4 + 1.5;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 2,
      r: Math.random() * 4 + 2,
      color,
      life: 28 + Math.floor(Math.random() * 20),
      maxLife: 48,
    });
  }
}

// ─── 描画 ─────────────────────────────────────────────────────────────────────
function draw() {
  // 論理座標(800x450)を物理ピクセルにスケール
  ctx.setTransform(canvas.width / CANVAS_W, 0, 0, canvas.height / CANVAS_H, 0, 0);

  drawBackground();

  if (state === STATE.TITLE) {
    drawTitle();
    return;
  }

  drawPerkGate();
  drawGoalGate();
  drawPowerups();
  drawEnemies();

  drawShockwaves();
  drawParticles();
  drawScorePopups();
  drawStompJumpEffect();
  drawPlayer();
  drawChicks();
  drawHUD();

  if (state === STATE.GAMEOVER) drawGameOver();
  if (state === STATE.PERK_CHOICE) drawPerkChoice();
  if (state === STATE.CLEAR) drawClear();
}

// --- 背景 ---
function drawBackground() {
  // 空グラデーション
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  sky.addColorStop(0, '#8ec8e8');
  sky.addColorStop(0.65, '#d8eef8');
  sky.addColorStop(1, '#eef6ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 遠景の山（パラレックス）
  ctx.fillStyle = '#b8ddf0';
  const mOffset = (scrollX * 0.08) % CANVAS_W;
  drawMountains(-mOffset);
  drawMountains(-mOffset + CANVAS_W);

  // 中景の山
  ctx.fillStyle = '#cce8f4';
  const m2 = (scrollX * 0.15) % CANVAS_W;
  drawMountains(-m2);
  drawMountains(-m2 + CANVAS_W);

  // 雪
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  snowflakes.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  });

  // 地面
  const gnd = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_H);
  gnd.addColorStop(0, '#ddf0ff');
  gnd.addColorStop(0.4, '#b8d8f0');
  gnd.addColorStop(1, '#90bce0');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);

  // 地面の模様（氷のヒビ）
  ctx.strokeStyle = 'rgba(160, 210, 240, 0.6)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    const ox = CANVAS_W - ((scrollX * 0.8 + i * 130) % (CANVAS_W + 130));
    ctx.beginPath();
    ctx.moveTo(ox, GROUND_Y + 8);
    ctx.lineTo(ox + 35, GROUND_Y + 18);
    ctx.lineTo(ox + 65, GROUND_Y + 12);
    ctx.stroke();
  }
}

function drawMountains(offsetX) {
  // タイルする山をいくつか並べる
  const configs = [
    { x: 0, w: 280, h: 130 },
    { x: 220, w: 200, h: 100 },
    { x: 380, w: 320, h: 150 },
    { x: 650, w: 240, h: 120 },
    { x: 850, w: 200, h: 90 },
  ];
  configs.forEach(c => {
    const mx = c.x + offsetX;
    ctx.beginPath();
    ctx.moveTo(mx, GROUND_Y);
    ctx.lineTo(mx + c.w / 2, GROUND_Y - c.h);
    ctx.lineTo(mx + c.w, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    // 雪冠
    const prevFill = ctx.fillStyle;
    ctx.fillStyle = '#ffffff';
    const capW = c.w * 0.28;
    ctx.beginPath();
    ctx.moveTo(mx + c.w / 2 - capW * 0.55, GROUND_Y - c.h * 0.62);
    ctx.lineTo(mx + c.w / 2, GROUND_Y - c.h);
    ctx.lineTo(mx + c.w / 2 + capW * 0.55, GROUND_Y - c.h * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = prevFill;
  });
}

function calcWingFlap() {
  if (state === STATE.DYING)                    return Math.sin(gameTime * 0.55) * 25;  // 死亡：激しく
  if (player.flying)                            return Math.sin(gameTime * 0.58) * 38;  // 飛行：常に激しく（大振幅・高速）
  if (!player.onGround && player.jumpCount >= 2) return Math.sin(gameTime * 0.52) * 22;  // 2段目：激しく
  if (!player.onGround)                         return Math.sin(gameTime * 0.30) * 13;  // 1段目：中程度
  return Math.sin(player.animFrame * 1.6) * 6;                                          // 歩行：小さく
}

// --- コウテイペンギン描画（無敵中） ---
function drawEmperorPenguin() {
  // 残り2秒を切ったら点滅
  if (player.shieldTimer < 120 && Math.floor(player.shieldTimer / 5) % 2 === 1) return;

  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (!player.facingRight) ctx.scale(-1, 1);
  ctx.scale(1.25, 1.25);

  // 金色のオーラ
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 28;

  // 体（黒）
  ctx.fillStyle = '#111122';
  ctx.beginPath();
  ctx.ellipse(0, 6, 17, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // 腹（白）
  ctx.fillStyle = '#f0f4f8';
  ctx.beginPath();
  ctx.ellipse(3, 9, 10, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  // 頭（黒）
  ctx.fillStyle = '#111122';
  ctx.beginPath();
  ctx.ellipse(2, -14, 13, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // 顔の白パッチ
  ctx.fillStyle = '#f0f4f8';
  ctx.beginPath();
  ctx.ellipse(5, -12, 7, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // 黄橙色の耳パッチ（コウテイペンギンの特徴）
  ctx.fillStyle = '#ffaa00';
  ctx.beginPath();
  ctx.ellipse(-3, -20, 5, 8, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(8, -21, 4, 6, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // 目
  ctx.fillStyle = '#111122';
  ctx.beginPath(); ctx.arc(9, -17, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(10.5, -18.5, 1.8, 0, Math.PI * 2); ctx.fill();

  // クチバシ（細長い）
  ctx.fillStyle = '#cc6600';
  ctx.beginPath();
  ctx.moveTo(13, -15); ctx.lineTo(25, -11); ctx.lineTo(13, -7);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ff8800';
  ctx.beginPath();
  ctx.moveTo(13, -13); ctx.lineTo(23, -11); ctx.lineTo(18, -11);
  ctx.closePath(); ctx.fill();

  // 翼（黒）
  const emperorWingFlap = calcWingFlap();
  ctx.fillStyle = '#111122';
  ctx.save();
  ctx.translate(19, 10); ctx.rotate((emperorWingFlap - 8) * Math.PI / 180);
  ctx.beginPath(); ctx.ellipse(0, 0, 7, 18, -0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(-18, 10); ctx.rotate((-emperorWingFlap + 8) * Math.PI / 180);
  ctx.beginPath(); ctx.ellipse(0, 0, 7, 18, 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // 足
  ctx.fillStyle = '#ff8c00';
  if (player.onGround && !player.flying) {
    const f = player.animFrame % 2;
    ctx.beginPath(); ctx.ellipse(-7, 26, 8, 4.5, f === 0 ? 0.3 : -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7, 26, 8, 4.5, f === 0 ? -0.15 : 0.3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.ellipse(-7, 26, 8, 4.5, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7, 26, 8, 4.5, -0.15, 0, Math.PI * 2); ctx.fill();
  }

  // 頭の王冠
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.moveTo(-8, -26); ctx.lineTo(-8, -34); ctx.lineTo(-3, -29);
  ctx.lineTo(2, -38); ctx.lineTo(7, -29); ctx.lineTo(12, -34); ctx.lineTo(12, -26);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ff3355';
  ctx.beginPath(); ctx.arc(2, -32, 3, 0, Math.PI * 2); ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

// --- プレイヤー描画 ---
function drawPlayer() {
  // 無敵アイテム中はコウテイペンギンに変身
  if (player.shieldTimer > 0) { drawEmperorPenguin(); return; }

  if (player.invincible > 0 && Math.floor(player.invincible / 5) % 2 === 1) return;

  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (!player.facingRight) ctx.scale(-1, 1);

  // 死亡アニメーション：横に倒れる
  if (state === STATE.DYING) {
    ctx.rotate(player.deathAngle);
  }

  if (player.flying) {
    ctx.shadowColor = '#66ccff';
    ctx.shadowBlur = 22;
  }

  // ─ 体 ─
  ctx.fillStyle = '#c8d4de';
  ctx.beginPath();
  ctx.ellipse(0, 6, 17, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // 腹（白）
  ctx.fillStyle = '#eef4f8';
  ctx.beginPath();
  ctx.ellipse(3, 9, 10, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  // 追加ジャンプが残っている間は翼が水色に光る（使い切るとグレーに戻る）
  const canAirJump = !player.onGround &&
    (player.flying || player.jumpCount < maxAirJumps()) &&
    state !== STATE.TITLE && state !== STATE.DYING;
  const wingColor = canAirJump ? '#8fd8ff' : '#9aaabb';

  // ─ パンチグローブの腕（頭より先に描いて顔の奥側に回し、クチバシを隠さない） ─
  const gloveUp = perkLevel('glove') > 0 && !player.onGround && state !== STATE.DYING;
  if (gloveUp) {
    ctx.save();
    ctx.translate(13, -2 - gloveThrust());   // 肩から上へ
    ctx.rotate(GLOVE_ANGLE);                  // 少し外側に傾ける
    if (canAirJump) { ctx.shadowColor = '#55ccff'; ctx.shadowBlur = 14; }
    ctx.fillStyle = wingColor;
    ctx.beginPath();
    ctx.ellipse(0, -13, 6, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // 翼の先のグローブ（この円がそのまま当たり判定。Lvで大きくなる）
    ctx.fillStyle = '#e03048';
    ctx.strokeStyle = '#a01830';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -GLOVE_ARM_LEN, gloveRadius(), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ─ 頭 ─
  ctx.fillStyle = '#c0ccd8';
  ctx.beginPath();
  ctx.ellipse(2, -14, 13, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // 顔の白パッチ
  ctx.fillStyle = '#eef4f8';
  ctx.beginPath();
  ctx.ellipse(4, -13, 9, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 目
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.arc(9, -17, 4.5, 0, Math.PI * 2);
  ctx.fill();
  // ハイライト
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(10.5, -18.5, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // クチバシ
  ctx.fillStyle = '#ff8c00';
  ctx.beginPath();
  ctx.moveTo(15, -14);
  ctx.lineTo(22, -11);
  ctx.lineTo(15, -8);
  ctx.closePath();
  ctx.fill();

  // ─ マグネット装備：頭のUじしゃく ─
  if (perkLevel('magnet') > 0) {
    ctx.save();
    ctx.translate(2, -31);
    ctx.strokeStyle = '#ee3344';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(-6.5, -6);
    ctx.lineTo(-6.5, 0);
    ctx.arc(0, 0, 6.5, Math.PI, 0, true);  // U字の底
    ctx.lineTo(6.5, -6);
    ctx.stroke();
    // 先端の白い部分
    ctx.strokeStyle = '#eef4f8';
    ctx.beginPath();
    ctx.moveTo(-6.5, -6); ctx.lineTo(-6.5, -10);
    ctx.moveTo(6.5, -6); ctx.lineTo(6.5, -10);
    ctx.stroke();
    ctx.restore();
  }

  // ─ 翼 ─
  const wingFlap = calcWingFlap();

  ctx.save();
  if (canAirJump) { ctx.shadowColor = '#55ccff'; ctx.shadowBlur = 14; }
  ctx.fillStyle = wingColor;
  // 右翼（前）: グローブで突き上げ中は描かない（腕は頭の奥側に描画済み）
  if (!gloveUp) {
    ctx.save();
    ctx.translate(19, 10);
    ctx.rotate((wingFlap - 8) * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 18, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // 左翼（後ろ）
  ctx.save();
  ctx.translate(-18, 10);
  ctx.rotate((-wingFlap + 8) * Math.PI / 180);
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 18, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // ─ 足 ─
  // 歩行アニメ：地上では左右の足の傾きを交互に入れ替える
  const f = player.onGround && !player.flying ? player.animFrame % 2 : 0;
  const footRots = [f === 0 ? 0.3 : -0.15, f === 0 ? -0.15 : 0.3];
  const hasShoes = perkLevel('shock') > 0;  // ふみつけドッカーン装備：くつ
  [[-7, footRots[0]], [7, footRots[1]]].forEach(([fx, rot]) => {
    ctx.save();
    ctx.translate(fx, 26);
    ctx.rotate(rot);
    if (hasShoes) {
      // くつ本体（衝撃波と同じ黄色系）
      ctx.fillStyle = '#ffbb22';
      ctx.strokeStyle = '#dd8800';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, -1.5, 8.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 白いソール
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 2.8, 8.5, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ff8c00';
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });

  ctx.shadowBlur = 0;
  ctx.restore();
}

// --- ちびペンギン（パーク：プレイヤーの周りを回る） ---
function drawChicks() {
  chickPositions().forEach(c => {
    ctx.save();
    ctx.translate(c.x, c.y + Math.sin(gameTime * 0.3 + c.angle) * 1.5);
    // 軌道の進行方向（角度の微分）に顔を向ける
    if (Math.sin(c.angle) >= 0) ctx.scale(-1, 1);

    // 体
    ctx.fillStyle = '#b8c8d4';
    ctx.beginPath(); ctx.ellipse(0, 3, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
    // 腹
    ctx.fillStyle = '#f0f5f8';
    ctx.beginPath(); ctx.ellipse(1.5, 4, 5.5, 7.5, 0, 0, Math.PI * 2); ctx.fill();
    // 頭
    ctx.fillStyle = '#aebecc';
    ctx.beginPath(); ctx.arc(1, -8, 7, 0, Math.PI * 2); ctx.fill();
    // 目
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath(); ctx.arc(3.5, -9.5, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(4.3, -10.3, 0.9, 0, Math.PI * 2); ctx.fill();
    // クチバシ
    ctx.fillStyle = '#ff8c00';
    ctx.beginPath(); ctx.moveTo(7, -8.5); ctx.lineTo(11, -7); ctx.lineTo(7, -5.5); ctx.closePath(); ctx.fill();
    // 翼（パタパタ）
    const flap = Math.sin(gameTime * 0.4 + c.angle) * 20;
    ctx.fillStyle = '#93a5b5';
    ctx.save();
    ctx.translate(8, 2); ctx.rotate((flap - 10) * Math.PI / 180);
    ctx.beginPath(); ctx.ellipse(0, 0, 3.5, 8, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.restore();
  });
}

// --- アザラシ ---
function drawSeal(e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  ctx.save();
  ctx.translate(cx, cy);

  // バリアントごとのカラーパレット
  let bodyCol, headCol, finCol, whiskerCol;
  if (e.jumping && e.fast) {
    // ジャンプ＋速い：赤紫（最強）
    bodyCol = '#a04858'; headCol = '#b85868'; finCol = '#883848'; whiskerCol = '#cc8899';
  } else if (e.fast) {
    // 速い：橙色
    bodyCol = '#c07840'; headCol = '#d08850'; finCol = '#a86030'; whiskerCol = '#e8bb88';
  } else if (e.jumping) {
    // ジャンプ：高さに応じて色の濃さを変える
    if (e.jumpPower <= -12) {
      // 高ジャンプ：濃い青紫
      bodyCol = '#4030a0'; headCol = '#5040b4'; finCol = '#302090'; whiskerCol = '#9080d0';
    } else if (e.jumpPower <= -9) {
      // 中ジャンプ：中間の青
      bodyCol = '#2860a8'; headCol = '#3872bc'; finCol = '#184e98'; whiskerCol = '#80a8d8';
    } else {
      // 低ジャンプ：明るい青緑
      bodyCol = '#3d8f7a'; headCol = '#4ea08a'; finCol = '#2d7060'; whiskerCol = '#88ccbb';
    }
  } else {
    // 通常：青灰色
    bodyCol = '#7a8fa0'; headCol = '#8aa0b0'; finCol = '#6a8090'; whiskerCol = '#aabbc8';
  }

  // 体
  ctx.fillStyle = bodyCol;
  ctx.beginPath();
  ctx.ellipse(0, 4, 28, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // 頭
  ctx.fillStyle = headCol;
  ctx.beginPath();
  ctx.ellipse(-22, -4, 14, 14, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // 目
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(-27, -8, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-25.5, -9.5, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // ひげ
  ctx.strokeStyle = whiskerCol;
  ctx.lineWidth = 1.2;
  [[-36, -4], [-38, -2], [-36, 0]].forEach(([wx, wy]) => {
    ctx.beginPath();
    ctx.moveTo(-30, -4);
    ctx.lineTo(wx, wy);
    ctx.stroke();
  });

  // 尾びれ
  const tailWag = Math.sin(gameTime * 0.18) * 12;
  ctx.save();
  ctx.translate(24, 6);
  ctx.rotate(tailWag * Math.PI / 180);
  ctx.fillStyle = finCol;
  ctx.beginPath();
  ctx.ellipse(8, 0, 16, 7, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 前ひれ
  const finWag = Math.sin(gameTime * 0.14) * 10 - 5;
  ctx.save();
  ctx.translate(-8, 12);
  ctx.rotate(finWag * Math.PI / 180);
  ctx.fillStyle = finCol;
  ctx.beginPath();
  ctx.ellipse(0, 8, 6, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// --- トウゾクカモメ（鳥） ---
function drawBird(e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  ctx.save();
  ctx.translate(cx, cy);

  const flap = Math.sin(gameTime * 0.22 + e.phase) * 18;

  // バリアントごとのカラーパレット
  let bBodyCol, bHeadCol, bWingCol, bTailCol, bBeakCol;
  if (e.type === 'diveBird') {
    // 上下に動く鳥：暗い青紫（危険感）
    bBodyCol = '#50607a'; bHeadCol = '#3d4d62'; bWingCol = '#445570'; bTailCol = '#50607a'; bBeakCol = '#7788aa';
  } else {
    // 通常の鳥：茶色系
    bBodyCol = '#8b7355'; bHeadCol = '#6d5a40'; bWingCol = '#7a6245'; bTailCol = '#8b7355'; bBeakCol = '#aa8840';
  }

  // 体
  ctx.fillStyle = bBodyCol;
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // 頭
  ctx.fillStyle = bHeadCol;
  ctx.beginPath();
  ctx.ellipse(-18, -4, 10, 10, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // クチバシ
  ctx.fillStyle = bBeakCol;
  ctx.beginPath();
  ctx.moveTo(-26, -4);
  ctx.lineTo(-36, -2);
  ctx.lineTo(-26, 0);
  ctx.closePath();
  ctx.fill();

  // 目
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-20, -7, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(-19.5, -7, 2, 0, Math.PI * 2);
  ctx.fill();

  // 翼（上）
  ctx.fillStyle = bWingCol;
  ctx.save();
  ctx.translate(0, -6);
  ctx.rotate(-flap * Math.PI / 180);
  ctx.beginPath();
  ctx.ellipse(0, -9, 20, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 翼（下）
  ctx.save();
  ctx.translate(0, 6);
  ctx.rotate(flap * Math.PI / 180);
  ctx.beginPath();
  ctx.ellipse(0, 9, 20, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 尾
  ctx.fillStyle = bTailCol;
  ctx.beginPath();
  ctx.moveTo(18, -5);
  ctx.lineTo(30, -10);
  ctx.lineTo(32, 0);
  ctx.lineTo(30, 10);
  ctx.lineTo(18, 5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// --- 魚パワーアップ ---
function drawFish(p) {
  const pulse = Math.sin(gameTime * 0.12) * 4;
  ctx.save();
  ctx.translate(p.x, p.y + pulse);

  // 輝きエフェクト
  ctx.shadowColor = '#88eeff';
  ctx.shadowBlur = 18;

  // 体
  ctx.fillStyle = '#55ccff';
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // 尾
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(26, -9);
  ctx.lineTo(26, 9);
  ctx.closePath();
  ctx.fill();

  // 光沢
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(-4, -3, 6, 3.5, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // 目
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-12, -2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(-11, -2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  // 周りの星
  ctx.fillStyle = '#ffee33';
  for (let i = 0; i < 4; i++) {
    const a = gameTime * 0.06 + i * Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 30, Math.sin(a) * 22, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// --- 王冠アイテム（無敵） ---
function drawShieldItem(p) {
  const pulse = Math.sin(gameTime * 0.11) * 4;
  ctx.save();
  ctx.translate(p.x, p.y + pulse);
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#ffd700';
  ctx.strokeStyle = '#cc8800';
  ctx.lineWidth = 1.5;
  // 王冠のベース
  ctx.beginPath();
  ctx.rect(-18, 4, 36, 11);
  ctx.fill();
  ctx.stroke();
  // 王冠の突起（3つ）
  ctx.beginPath();
  ctx.moveTo(-18, 4);
  ctx.lineTo(-18, -11);
  ctx.lineTo(-9, -1);
  ctx.lineTo(0, -16);
  ctx.lineTo(9, -1);
  ctx.lineTo(18, -11);
  ctx.lineTo(18, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 宝石
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff3355';
  ctx.beginPath(); ctx.arc(0, -9, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#55aaff';
  ctx.beginPath(); ctx.arc(-13, -5, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(13, -5, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// --- ハートアイテム ---
function drawHeartItem(p) {
  const pulse = Math.sin(gameTime * 0.1) * 4;
  ctx.save();
  ctx.translate(p.x, p.y + pulse);
  ctx.scale(1.4, 1.4);
  ctx.shadowColor = '#ff3355';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ff3355';
  ctx.strokeStyle = '#cc0022';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-12, -4, -14, 10, 0, 18);
  ctx.bezierCurveTo(14, 10, 12, -4, 0, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// --- スターアイテム ---
function drawStarItem(p) {
  const pulse = Math.sin(gameTime * 0.09) * 4;
  ctx.save();
  ctx.translate(p.x, p.y + pulse);
  ctx.rotate(gameTime * 0.02);
  ctx.shadowColor = '#ffdd00';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#ffdd00';
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI / 5) - Math.PI / 2;
    const r = i % 2 === 0 ? 20 : 9;
    if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawPowerups() {
  powerups.forEach(p => {
    if (p.type === 'heart') drawHeartItem(p);
    else if (p.type === 'star') drawStarItem(p);
    else if (p.type === 'shield') drawShieldItem(p);
    else drawFish(p);
  });
}

function drawEnemies() {
  enemies.forEach(e => {
    if (e.knocked) {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(e.rotation);
      // 描画関数が cx=e.x+e.w/2, cy=e.y+e.h/2 を使うため一時的にずらす
      const ox = e.x, oy = e.y;
      e.x = -e.w / 2;
      e.y = -e.h / 2;
      if (e.type === 'seal') drawSeal(e);
      else drawBird(e);
      e.x = ox;
      e.y = oy;
      ctx.restore();
    } else {
      if (e.type === 'seal') drawSeal(e);
      else drawBird(e);
    }
  });
}


// --- ストンプ衝撃波のリング（効果範囲まで広がって消える） ---
function drawShockwaves() {
  shockwaves.forEach(s => {
    const t = s.life / SHOCKWAVE_LIFE;          // 0→1
    const r = shockwaveRadius(s);               // 判定と同じ半径を描く
    const alpha = 1 - t;

    ctx.save();
    // 外側リング：効果範囲の境界を示す
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = '#ffcc66';
    ctx.shadowColor = '#ff8800';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 5 - t * 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // 内側のリングで厚みを出す
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

function drawParticles() {
  particles.forEach(p => {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// --- HUD ---
function drawHUD() {
  // スコア
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#224488';
  ctx.lineWidth = 3;
  ctx.strokeText(`スコア: ${player.score}`, 16, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`スコア: ${player.score}`, 16, 36);

  ctx.font = 'bold 16px Arial';
  ctx.strokeStyle = '#224488';
  ctx.lineWidth = 3;
  ctx.strokeText(`ハイスコア: ${Math.max(player.score, highScore)}`, 16, 58);
  ctx.fillStyle = '#ffeedd';
  ctx.fillText(`ハイスコア: ${Math.max(player.score, highScore)}`, 16, 58);

  // HP ハート（ハイスコアの下・左寄せ）
  for (let i = 0; i < maxHp(); i++) {
    drawHeart(30 + i * 32, 70, i < player.hp);
  }

  // 取得済みパーク（右上にチップ表示）
  drawPerkChips();

  const bw = 200;
  const bh = 18;
  const bx = CANVAS_W / 2 - bw / 2;
  let gaugeY = 12;

  // 飛行ゲージ
  if (player.flying) {
    const ratio = player.flyTimer / FLY_DURATION;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, bx - 2, gaugeY - 2, bw + 4, bh + 4, 6);
    ctx.fill();

    const barGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    barGrad.addColorStop(0, '#66ddff');
    barGrad.addColorStop(1, '#2277ff');
    ctx.fillStyle = barGrad;
    roundRect(ctx, bx, gaugeY, bw * ratio, bh, 5);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('★ 無限ジャンプ ★', CANVAS_W / 2, gaugeY + bh - 3);

    gaugeY += bh + 6;
  }

  // 無敵ゲージ
  if (player.shieldTimer > 0) {
    const ratio = player.shieldTimer / SHIELD_DURATION;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, bx - 2, gaugeY - 2, bw + 4, bh + 4, 6);
    ctx.fill();

    const barGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    barGrad.addColorStop(0, '#ffee66');
    barGrad.addColorStop(1, '#ff8800');
    ctx.fillStyle = barGrad;
    roundRect(ctx, bx, gaugeY, bw * ratio, bh, 5);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('★ 無敵 ★', CANVAS_W / 2, gaugeY + bh - 3);
  }
}

// --- パワーアップゲート（くぐるとパーク選択） ---
function drawPerkGate() {
  if (!perkGate) return;
  const gx = perkGate.x;
  const half = 55;             // 中心から柱までの距離
  const topY = GROUND_Y - 185; // 柱の上端
  const pulse = 0.55 + Math.sin(gameTime * 0.08) * 0.25;

  ctx.save();

  // 柱の間の光のカーテン
  const beam = ctx.createLinearGradient(0, topY, 0, GROUND_Y);
  beam.addColorStop(0, `rgba(120, 220, 255, ${0.35 * pulse})`);
  beam.addColorStop(1, 'rgba(120, 220, 255, 0)');
  ctx.fillStyle = beam;
  ctx.fillRect(gx - half + 7, topY, half * 2 - 14, GROUND_Y - topY);

  // 氷の柱（左右）
  [-half, half].forEach(off => {
    const px = gx + off;
    ctx.fillStyle = '#bfe9ff';
    ctx.strokeStyle = '#7fc4e8';
    ctx.lineWidth = 2;
    roundRect(ctx, px - 7, topY, 14, GROUND_Y - topY, 5);
    ctx.fill();
    ctx.stroke();
    // 柱のハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(px - 4, topY + 8, 3, GROUND_Y - topY - 16);
  });

  // 上部バナー
  ctx.shadowColor = '#66ddff';
  ctx.shadowBlur = 12 * pulse;
  ctx.fillStyle = '#1a4488';
  ctx.strokeStyle = '#bfe9ff';
  ctx.lineWidth = 2;
  roundRect(ctx, gx - half - 14, topY - 34, half * 2 + 28, 30, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('パワーアップ！', gx, topY - 13);

  // 点滅する矢印（くぐる位置の誘導）
  if (Math.floor(gameTime / 20) % 2 === 0) {
    ctx.fillStyle = `rgba(255, 238, 68, ${Math.min(1, pulse + 0.2)})`;
    ctx.font = 'bold 22px Arial';
    ctx.fillText('▼', gx, topY - 44);
  }

  ctx.restore();
}

// --- ゴールゲート（くぐるとクリア） ---
function drawGoalGate() {
  if (!goalGate) return;
  const gx = goalGate.x;
  const half = 55;
  const topY = GROUND_Y - 185;
  const pulse = 0.55 + Math.sin(gameTime * 0.08) * 0.25;

  ctx.save();

  // 金色の光のカーテン
  const beam = ctx.createLinearGradient(0, topY, 0, GROUND_Y);
  beam.addColorStop(0, `rgba(255, 215, 80, ${0.4 * pulse})`);
  beam.addColorStop(1, 'rgba(255, 215, 80, 0)');
  ctx.fillStyle = beam;
  ctx.fillRect(gx - half + 7, topY, half * 2 - 14, GROUND_Y - topY);

  // 紅白の柱（左右）
  [-half, half].forEach(off => {
    const px = gx + off;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, px - 7, topY, 14, GROUND_Y - topY, 5);
    ctx.fill();
    ctx.save();
    ctx.clip();  // 縞模様を柱の角丸内に収める
    ctx.fillStyle = '#ee3344';
    for (let y = topY + 12; y < GROUND_Y; y += 28) {
      ctx.fillRect(px - 7, y, 14, 14);
    }
    ctx.restore();
    ctx.strokeStyle = '#cc2233';
    ctx.lineWidth = 2;
    roundRect(ctx, px - 7, topY, 14, GROUND_Y - topY, 5);
    ctx.stroke();
  });

  // 上部バナー
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 14 * pulse;
  ctx.fillStyle = '#ee3344';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  roundRect(ctx, gx - half - 14, topY - 34, half * 2 + 28, 30, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('ゴール！', gx, topY - 12);

  // 点滅する旗マーク
  if (Math.floor(gameTime / 20) % 2 === 0) {
    ctx.font = 'bold 22px Arial';
    ctx.fillStyle = `rgba(255, 215, 0, ${Math.min(1, pulse + 0.2)})`;
    ctx.fillText('🚩', gx, topY - 44);
  }

  ctx.restore();
}

// --- クリア画面 ---
function drawClear() {
  ctx.fillStyle = 'rgba(10, 20, 50, 0.6)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = 'center';

  if (player.score >= highScore && player.score > 0) {
    if (Math.floor(gameTime / 15) % 2 === 0) {
      ctx.fillStyle = '#ff66aa';
      ctx.font = 'bold 22px Arial';
      ctx.fillText('NEW RECORD!', CANVAS_W / 2, CANVAS_H / 2 - 110);
    }
  }

  ctx.font = 'bold 58px Arial';
  ctx.strokeStyle = '#aa6600';
  ctx.lineWidth = 5;
  ctx.strokeText('ゴール！！', CANVAS_W / 2, CANVAS_H / 2 - 40);
  ctx.fillStyle = '#ffd700';
  ctx.fillText('ゴール！！', CANVAS_W / 2, CANVAS_H / 2 - 40);

  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('クリア おめでとう！', CANVAS_W / 2, CANVAS_H / 2 - 4);

  ctx.font = 'bold 26px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`スコア: ${player.score}`, CANVAS_W / 2, CANVAS_H / 2 + 36);

  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#ffd700';
  ctx.fillText(`ハイスコア: ${highScore}`, CANVAS_W / 2, CANVAS_H / 2 + 64);

  if (Math.floor(gameTime / 28) % 2 === 0) {
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#aaccff';
    ctx.fillText('Space / タップ で もういちど！', CANVAS_W / 2, CANVAS_H / 2 + 100);
  }
}

// --- 取得済みパークのチップ表示（右上） ---
function drawPerkChips() {
  let y = 14;
  PERKS.forEach(perk => {
    const lv = perkLevel(perk.id);
    if (lv === 0 || perk.instant) return;
    const label = lv > 1 ? `${perk.name} Lv.${lv}` : perk.name;
    ctx.font = 'bold 11px Arial';
    const w = ctx.measureText(label).width + 14;
    const x = CANVAS_W - 12 - w;
    ctx.fillStyle = 'rgba(10, 20, 50, 0.5)';
    roundRect(ctx, x, y, w, 17, 8);
    ctx.fill();
    ctx.strokeStyle = perk.hidden ? '#ffcc44' : PERK_COLOR;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, 17, 8);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 7, y + 13);
    y += 21;
  });
}

// --- パーク選択画面 ---
function drawPerkChoice() {
  ctx.fillStyle = 'rgba(0, 5, 30, 0.6)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = 'center';
  ctx.font = 'bold 34px Arial';
  ctx.strokeStyle = '#1a4488';
  ctx.lineWidth = 5;
  ctx.strokeText('パワーアップを えらぼう！', CANVAS_W / 2, 80);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('パワーアップを えらぼう！', CANVAS_W / 2, 80);

  const rects = perkCardRects(perkChoices.length);
  perkChoices.forEach((perk, i) => {
    const r = rects[i];
    const selected = i === perkCursor;
    const cardColor = perk.hidden ? '#ffcc44' : PERK_COLOR;  // かくしパークは金枠

    ctx.save();
    ctx.translate(r.x, r.y + (selected ? -6 : 0));

    // カード本体
    ctx.fillStyle = selected ? 'rgba(30, 50, 95, 0.97)' : 'rgba(18, 30, 60, 0.93)';
    roundRect(ctx, 0, 0, r.w, r.h, 12);
    ctx.fill();
    if (selected || perk.hidden) { ctx.shadowColor = cardColor; ctx.shadowBlur = selected ? 16 : 10; }
    ctx.strokeStyle = cardColor;
    ctx.lineWidth = selected ? 4 : 2;
    roundRect(ctx, 0, 0, r.w, r.h, 12);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // パーク名
    ctx.textAlign = 'center';
    ctx.font = 'bold 19px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(perk.name, r.w / 2, 48);

    // 説明
    ctx.font = '13px Arial';
    ctx.fillStyle = '#cfe2ff';
    perk.desc.forEach((line, li) => {
      ctx.fillText(line, r.w / 2, 92 + li * 20);
    });

    // レベル表示（即時効果のパークは出さない）
    if (!perk.instant) {
      const lv = perkLevel(perk.id);
      ctx.font = 'bold 14px Arial';
      ctx.fillStyle = lv === 0 ? '#7fe2a8' : '#ffd700';
      ctx.fillText(lv === 0 ? 'NEW!' : `Lv.${lv} → Lv.${lv + 1}`, r.w / 2, r.h - 40);
    }

    // キーヒント
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = '#88aacc';
    ctx.fillText(`[${i + 1}]`, r.w / 2, r.h - 14);

    ctx.restore();
  });

  if (Math.floor(perkUiTime / 28) % 2 === 0) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = '#aaccff';
    const keysHint = perkChoices.length > 3 ? '1・2・3・4' : '1・2・3';
    ctx.fillText(`カードをタップ か ${keysHint} キーで えらんでね`, CANVAS_W / 2, 418);
  }
}

function drawHeart(x, y, filled) {
  ctx.save();
  ctx.translate(x, y);
  if (filled) {
    ctx.fillStyle = '#ff3355';
    ctx.strokeStyle = '#cc0022';
  } else {
    ctx.fillStyle = '#445566';
    ctx.strokeStyle = '#334455';
  }
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-12, -4, -14, 10, 0, 18);
  ctx.bezierCurveTo(14, 10, 12, -4, 0, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// --- タイトル画面 ---
function drawTitle() {
  // ─ ペンギンのジャンプアニメーション ─
  const JUMP_CYCLE  = 90;   // 1サイクル（フレーム）
  const JUMP_FRAMES = 62;   // 空中にいるフレーム数
  const JUMP_HEIGHT = 75;   // 最大ジャンプ高さ（px）

  const phase = gameTime % JUMP_CYCLE;
  const inAir = phase < JUMP_FRAMES;
  const t     = phase / JUMP_FRAMES;                          // 0→1（空中の進行度）
  const jumpY = inAir ? -JUMP_HEIGHT * Math.sin(Math.PI * t) : 0;  // 放物線
  const tilt  = inAir ? Math.cos(Math.PI * t) * 0.18 : 0;          // 上昇：前傾き、下降：後傾き

  const baseY     = GROUND_Y - player.h;
  const penguinCX = CANVAS_W / 2;
  const penguinCY = baseY + player.h / 2 + jumpY;

  player.x          = penguinCX - player.w / 2;
  player.y          = baseY + jumpY;
  player.facingRight = Math.floor(gameTime / JUMP_CYCLE) % 2 === 0;  // 着地ごとに反転
  player.flying     = false;
  player.invincible = 0;
  player.onGround   = !inAir;
  player.animFrame  = Math.floor(gameTime / 3);

  ctx.save();
  ctx.translate(penguinCX, penguinCY);
  ctx.rotate(tilt);
  ctx.translate(-penguinCX, -penguinCY);
  drawPlayer();
  ctx.restore();

  player.onGround = false;

  // タイトル
  ctx.textAlign = 'center';
  ctx.font = 'bold 50px Arial';
  ctx.strokeStyle = '#1a4488';
  ctx.lineWidth = 5;
  ctx.strokeText('Penguin Adventure 2', CANVAS_W / 2, 52);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Penguin Adventure 2', CANVAS_W / 2, 52);

  // 操作説明
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = '#224488';
  ctx.fillText('Space / タップ：ジャンプ（長押しで高く・2段まで）', CANVAS_W / 2, 87);
  ctx.fillText('敵の上から踏みつけると撃破！　走った距離に応じてパワーアップを選ぼう', CANVAS_W / 2, 105);

  // アイテム説明（アイコン付き）
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = '#1a7744';
  ctx.fillText('─── アイテム ───', CANVAS_W / 2, 127);

  const iconY = 152;
  const iconScale = 0.65;
  const iconItems = [
    { type: 'fish', x: 160, label: '魚：無限ジャンプ' },
    { type: 'heart', x: 320, label: 'ハート：HP回復' },
    { type: 'star', x: 480, label: 'スター：+1000点' },
    { type: 'shield', x: 640, label: '王冠：無敵変身' },
  ];
  iconItems.forEach(item => {
    ctx.save();
    ctx.translate(item.x, iconY);
    ctx.scale(iconScale, iconScale);
    const p = { x: 0, y: 0, r: 22 };
    if (item.type === 'fish') drawFish(p);
    else if (item.type === 'heart') drawHeartItem(p);
    else if (item.type === 'star') drawStarItem(p);
    else if (item.type === 'shield') drawShieldItem(p);
    ctx.restore();

    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = '#224488';
    ctx.fillText(item.label, item.x, iconY + 28);
  });

  // 点滅スタートメッセージ
  if (Math.floor(gameTime / 28) % 2 === 0) {
    ctx.font = 'bold 20px Arial';
    ctx.strokeStyle = '#1a4488';
    ctx.lineWidth = 3;
    ctx.strokeText('Space / タップ でスタート！', CANVAS_W / 2, 208);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Space / タップ でスタート！', CANVAS_W / 2, 208);
  }

  // ハイスコア表示（中央を境に右寄せ）
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'right';
  ctx.strokeStyle = '#224488';
  ctx.lineWidth = 3;
  ctx.strokeText(`ハイスコア: ${highScore}`, CANVAS_W / 2 - 8, 232);
  ctx.fillStyle = '#ffeedd';
  ctx.fillText(`ハイスコア: ${highScore}`, CANVAS_W / 2 - 8, 232);

  // リセットボタン（中央を境に左寄せ）
  ctx.font = '14px Arial';
  ctx.textAlign = 'left';
  ctx.fillStyle = highScore > 0 ? '#88aacc' : '#445566';
  ctx.fillText('[リセット]', CANVAS_W / 2 + 8, 232);
}

// --- ゲームオーバー画面 ---
function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,20,0.62)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = 'center';
  ctx.font = 'bold 58px Arial';
  ctx.strokeStyle = '#660000';
  ctx.lineWidth = 5;
  ctx.strokeText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2 - 24);
  ctx.fillStyle = '#ff4455';
  ctx.fillText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2 - 24);

  ctx.font = 'bold 26px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`スコア: ${player.score}`, CANVAS_W / 2, CANVAS_H / 2 + 18);

  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#ffd700';
  ctx.fillText(`ハイスコア: ${Math.max(player.score, highScore)}`, CANVAS_W / 2, CANVAS_H / 2 + 45);

  if (player.score >= highScore && player.score > 0) {
    if (Math.floor(gameTime / 15) % 2 === 0) {
      ctx.fillStyle = '#ff66aa';
      ctx.font = 'bold 22px Arial';
      ctx.fillText('NEW RECORD!', CANVAS_W / 2, CANVAS_H / 2 - 105);
    }
  }

  if (Math.floor(gameTime / 28) % 2 === 0) {
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#aaccff';
    ctx.fillText('Space / Enter / タップ でリトライ', CANVAS_W / 2, CANVAS_H / 2 + 85);
  }
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}


// ─── ゲームループ（固定タイムステップ） ──────────────────────────────────────
const FIXED_DT = 1000 / 90;   // 1ティック = 約11.11ms（90FPS相当 = 1.5倍速）
let lastTimestamp = 0;
let accumulator = 0;

function gameLoop(timestamp) {
  if (lastTimestamp === 0) lastTimestamp = timestamp;

  // 経過時間を蓄積（タブ非表示等で大きくなりすぎないよう上限設定）
  accumulator += Math.min(timestamp - lastTimestamp, 200);
  lastTimestamp = timestamp;

  // 固定ステップで update を実行
  while (accumulator >= FIXED_DT) {
    update();
    accumulator -= FIXED_DT;
  }

  draw();
  requestAnimationFrame(gameLoop);
}

// 初期化して開始
initSnowflakes();
requestAnimationFrame(gameLoop);
