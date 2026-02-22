'use strict';

// ─── Canvas セットアップ ───────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const CANVAS_W = 800;
const CANVAS_H = 450;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;

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

// ─── ゲーム状態 ──────────────────────────────────────────────────────────────
const STATE = { TITLE: 0, PLAYING: 1, DYING: 2, GAMEOVER: 3 };
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
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
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

function handlePointerDown(mx, my) {
  // タイトル画面：ハイスコアリセットボタン判定
  if (state === STATE.TITLE) {
    const bx = CANVAS_W / 2 + 6, by = 217, bw = 76, bh = 20;
    if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
      highScore = 0;
      localStorage.setItem('penguin_highscore', '0');
      return;
    }
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
};

// ─── ゲームオブジェクト配列 ──────────────────────────────────────────────────
let enemies = [];
let powerups = [];
let particles = [];
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
let highScore = parseInt(localStorage.getItem('penguin_highscore') || '0', 10);

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
  });
  enemies = [];
  powerups = [];
  particles = [];
  scorePopups = [];
  scrollX = 0;
  gameTime = 0;
  spawnTimer = 180;
  powerupTimer = 350;
  distAccum = 0;
  airCombo = 0;
  sealStreak = 0;
  currentScrollSpeed = SCROLL_SPEED_INIT;
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
  if (state === STATE.TITLE || state === STATE.GAMEOVER) {
    if (code === 'Space') startGame();
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
    } else if (player.flying || player.jumpCount < 2) {
      player.vy = JUMP_POWER * (player.jumpCount === 1 && !player.flying ? 0.85 : 1);
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
    updateScorePopups();
    snowflakes.forEach(s => moveSnowflake(s));
    if (player.deathTimer <= 0) {
      if (player.score > highScore) {
        highScore = player.score;
        localStorage.setItem('penguin_highscore', highScore.toString());
      }
      state = STATE.GAMEOVER;
    }
    return;
  }

  if (state !== STATE.PLAYING) {
    // タイトル時も雪を動かす
    snowflakes.forEach(s => moveSnowflake(s));
    gameTime++;
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
  updateScorePopups();
  snowflakes.forEach(s => moveSnowflake(s));
  checkCollisions();

  // スポーン
  spawnTimer--;
  if (spawnTimer <= 0) {
    spawnEnemy();
    // 後半は2体同時スポーンの確率を追加（gameTime>6500 から最大20%）
    if (gameTime > 6500 && Math.random() < Math.min((gameTime - 6500) / 20000, 0.20)) {
      spawnEnemy();
    }
    // √カーブ＋後半は線形でさらに短縮（最小20フレーム）
    const sqrtDecay = Math.sqrt(gameTime) * 2.1;
    const lateDecay = Math.max(0, (gameTime - 3000) / 160);
    const interval = Math.max(20, Math.round(220 - sqrtDecay - lateDecay));
    spawnTimer = interval + Math.floor(Math.random() * (gameTime > 5000 ? 10 : 20));
  }
  powerupTimer--;
  if (powerupTimer <= 0) {
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
  const speed = currentScrollSpeed + 0.5 + Math.min(gameTime / 1200, 2);
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
  for (let i = powerups.length - 1; i >= 0; i--) {
    powerups[i].x -= currentScrollSpeed + 0.5;
    if (powerups[i].x < -60) powerups.splice(i, 1);
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
      const dir = e.x + e.w / 2 > player.x + player.w / 2 ? 1 : -1;
      e.knocked = true;
      e.vx = dir * (3 + Math.random() * 2);
      e.vy = -(4 + Math.random() * 3);
      e.rotation = 0;
      e.rotSpeed = (0.12 + Math.random() * 0.15) * dir;
      airCombo++;
      const comboMult = getComboMultiplier(airCombo);
      const pts = getEnemyScore(e) * comboMult;
      burst(e.x + e.w / 2, e.y + e.h / 2, '#aaddff', 12);
      addScorePopup(e.x + e.w / 2, e.y, pts, '#aaddff', comboMult);
      player.score += pts;
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
        const dir = e.x + e.w / 2 > player.x + player.w / 2 ? 1 : -1;
        e.knocked = true;
        e.vx = dir * (3 + Math.random() * 2);
        e.vy = -(4 + Math.random() * 3);
        e.rotation = 0;
        e.rotSpeed = (0.12 + Math.random() * 0.15) * dir;
        burst(e.x + e.w / 2, e.y + e.h / 2, '#ffd700', 12);
        let shieldMult = 1;
        if (!player.onGround) { airCombo++; shieldMult = getComboMultiplier(airCombo); }
        const shieldPts = getEnemyScore(e) * shieldMult;
        addScorePopup(e.x + e.w / 2, e.y, shieldPts, '#ffd700', shieldMult);
        player.score += shieldPts;
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
        player.hp = Math.min(player.hp + 1, 3);
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
  const baseSpeed = 0.3 + Math.min(gameTime / 900, 2.0);

  // 時間経過で強化バリアントの出現確率が上がる（後半はより積極的に出現）
  const jumpSealChance = gameTime > 1500 ? Math.min(Math.sqrt((gameTime - 1500) / 3500), 0.60) : 0;
  const diveBirdChance = gameTime > 1000 ? Math.min(Math.sqrt((gameTime - 1000) / 3500), 0.55) : 0;

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
    // 前半は登場しない。gameTime>3000 から線形で上昇（最大45%）
    const fastChance = gameTime > 3000 ? Math.min((gameTime - 3000) / 10000, 0.45) : 0;
    const isFast = Math.random() < fastChance;
    const sealSpeed = isFast
      ? baseSpeed + 1.8 + Math.random() * 1.0
      : baseSpeed + Math.random() * 1.2;

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
  drawBackground();

  if (state === STATE.TITLE) {
    drawTitle();
    return;
  }

  drawPowerups();
  drawEnemies();

  drawParticles();
  drawScorePopups();
  drawStompJumpEffect();
  drawPlayer();
  drawHUD();

  if (state === STATE.GAMEOVER) drawGameOver();
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

  // ─ 翼 ─
  const wingFlap = calcWingFlap();

  ctx.fillStyle = '#9aaabb';
  // 右翼（前）
  ctx.save();
  ctx.translate(19, 10);
  ctx.rotate((wingFlap - 8) * Math.PI / 180);
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 18, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 左翼（後ろ）
  ctx.save();
  ctx.translate(-18, 10);
  ctx.rotate((-wingFlap + 8) * Math.PI / 180);
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 18, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ─ 足 ─
  ctx.fillStyle = '#ff8c00';
  if (player.onGround && !player.flying) {
    const f = player.animFrame % 2;
    ctx.beginPath();
    ctx.ellipse(-7, 26, 8, 4.5, f === 0 ? 0.3 : -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7, 26, 8, 4.5, f === 0 ? -0.15 : 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(-7, 26, 8, 4.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7, 26, 8, 4.5, -0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
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
  for (let i = 0; i < 3; i++) {
    drawHeart(30 + i * 32, 70, i < player.hp);
  }

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
  ctx.strokeText('Penguin Adventure', CANVAS_W / 2, 52);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Penguin Adventure', CANVAS_W / 2, 52);

  // 操作説明
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = '#224488';
  ctx.fillText('Space / タップ：ジャンプ（長押しで高く・2段まで）', CANVAS_W / 2, 87);
  ctx.fillText('敵の上から踏みつけると撃破！　魚を取ると空中で何度でもジャンプ可能', CANVAS_W / 2, 105);

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
