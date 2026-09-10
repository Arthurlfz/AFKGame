/**
 * skill-effects.js — 技能演出引擎 v3
 * 模拟阴阳师式演出：白屏闪切 → 镜头拉近 → 技能名弹出 → 爆发 → 拉回
 */
(function () {
  'use strict';

  class Particle {
    constructor(x, y, opts) {
      this.x = x; this.y = y;
      this.vx = opts.vx || 0;
      this.vy = opts.vy || 0;
      this.life = opts.life || 1;
      this.maxLife = this.life;
      this.size = opts.size || 5;
      this.color = opts.color || '255,150,50';
      this.gravity = opts.gravity || 0;
      this.drag = opts.drag || 0.98;
      this.shrink = opts.shrink || 0.95;
      this.glow = opts.glow || 20;
      this.type = opts.type || 'circle'; // circle | spark | smoke
    }
    update(dt) {
      this.vx *= this.drag;
      this.vy *= this.drag;
      this.vy += this.gravity;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.size *= this.shrink;
      this.life -= dt;
    }
    get alpha() { return Math.max(0, this.life / this.maxLife); }
    draw(ctx) {
      const a = this.alpha;
      ctx.save();
      if (this.type === 'smoke') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(40,20,10,${a * 0.4})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = this.glow;
        ctx.shadowColor = `rgba(${this.color},${a})`;
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
        grad.addColorStop(0, `rgba(255,255,230,${a})`);
        grad.addColorStop(0.3, `rgba(${this.color},${a * 0.9})`);
        grad.addColorStop(1, `rgba(${this.color},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    get dead() { return this.life <= 0 || this.size < 0.5; }
  }

  function buildFireParticles(cx, cy) {
    const particles = [];

    // 大火球（中心）
    particles.push(new Particle(cx, cy, {
      vx: 0, vy: 0, life: 0.6, size: 80, color: '255,200,80', glow: 80,
    }));

    // 火焰扩散环
    for (let i = 0; i < 40; i++) {
      const angle = (Math.PI * 2 * i) / 40;
      const speed = 4 + Math.random() * 3;
      const hue = Math.random();
      const color = hue < 0.3 ? '255,230,120' : hue < 0.6 ? '255,160,50' : '200,60,15';
      particles.push(new Particle(cx, cy, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 0.8 + Math.random() * 0.4,
        size: 25 + Math.random() * 35,
        color, gravity: -0.03, drag: 0.93, shrink: 0.94, glow: 50,
      }));
    }

    // 火花
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 8;
      particles.push(new Particle(cx, cy, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6 + Math.random() * 0.5,
        size: 2 + Math.random() * 4,
        color: '255,220,100', gravity: 0.1, drag: 0.99, shrink: 0.96, glow: 12,
      }));
    }

    // 烟雾
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      particles.push(new Particle(cx + (Math.random()-0.5)*40, cy + (Math.random()-0.5)*40, {
        vx: Math.cos(angle) * 1.5,
        vy: Math.sin(angle) * 1.5 - 1,
        life: 1.2 + Math.random() * 0.5,
        size: 30 + Math.random() * 40,
        color: '0,0,0', gravity: -0.01, drag: 0.96, shrink: 0.99, glow: 0,
        type: 'smoke',
      }));
    }

    return particles;
  }

  function playSkillEffect(skillId, targetSide, skillName) {
    const stage = document.querySelector('.battle-stage');
    if (!stage) return;
    const petFighter = stage.querySelector('.fighter-pet .stage-avatar');
    let enemyFighter = stage.querySelector('.fighter-enemy .stage-avatar');
    const sr = stage.getBoundingClientRect();
    
    // 定位敌人位置：如果enemy立绘存在且有尺寸就用它，否则放舞台右侧
    let cx, cy;
    if (enemyFighter) {
      const er = enemyFighter.getBoundingClientRect();
      if (er.width > 10 && er.height > 10) {
        cx = er.left - sr.left + er.width / 2;
        cy = er.top - sr.top + er.height / 2;
      }
    }
    if (cx === undefined) {
      // fallback: 舞台右半区
      cx = sr.width * 0.75;
      cy = sr.height * 0.55;
    }

    // ===== 阶段2：镜头拉近 + 技能名（150-500ms） =====
    setTimeout(() => {
      // 镜头拉近
      stage.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.3, 1)';
      stage.style.transformOrigin = `${cx}px ${cy}px`;
      stage.style.transform = 'scale(1.15)';

      // 宠物发光蓄力
      petFighter.style.transition = 'filter 0.15s, box-shadow 0.15s';
      petFighter.style.filter = 'brightness(2) drop-shadow(0 0 30px #ffaa33)';
    }, 150);

    // 技能名弹出
    if (skillName) {
      const banner = document.createElement('div');
      banner.style.cssText = `
        position: absolute; left: 50%; top: 30%;
        transform: translateX(-50%) scale(0.3);
        font-size: 36px; font-weight: 900;
        color: #fff; text-shadow: 0 0 20px #ff6600, 0 0 60px #ff3300, 0 2px 4px #000;
        pointer-events: none; z-index: 201;
        opacity: 0; transition: all 0.2s cubic-bezier(0.2, 0.8, 0.3, 1.3);
        white-space: nowrap; letter-spacing: 4px;
      `;
      banner.textContent = skillName;
      stage.appendChild(banner);
      setTimeout(() => {
        requestAnimationFrame(() => {
          banner.style.opacity = '1';
          banner.style.transform = 'translateX(-50%) scale(1)';
        });
      }, 200);
      setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transform = 'translateX(-50%) scale(1.1)';
      }, 900);
      setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 1200);
    }

    // ===== 阶段3：爆发（500ms时） =====
    setTimeout(() => {
      // 创建Canvas粒子层
      const canvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      const W = stage.clientWidth, H = stage.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.cssText = `
        position: absolute; left: 0; top: 0;
        width: ${W}px; height: ${H}px;
        pointer-events: none; z-index: 150;
      `;
      stage.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const particles = buildFireParticles(cx, cy);
      const rings = [
        { r: 20, maxR: 250, prog: 0, color: '255,200,100', width: 8 },
        { r: 10, maxR: 350, prog: 0, color: '255,100,40', width: 5 },
      ];

      // 敌人被打退
      enemyFighter.style.transition = 'transform 0.2s ease-out, filter 0.1s';
      enemyFighter.style.transform = 'translateX(30px)';
      enemyFighter.style.filter = 'brightness(3) saturate(0)';
      setTimeout(() => {
        enemyFighter.style.transform = '';
        enemyFighter.style.filter = '';
      }, 400);

      // 屏幕震
      stage.style.transition = 'transform 0.04s';
      setTimeout(() => { stage.style.transform = 'translate(8px, -5px) scale(1.15)'; }, 0);
      setTimeout(() => { stage.style.transform = 'translate(-8px, 5px) scale(1.15)'; }, 60);
      setTimeout(() => { stage.style.transform = 'translate(4px, -3px) scale(1.15)'; }, 120);
      setTimeout(() => { stage.style.transform = 'translate(0, 0) scale(1.15)'; }, 180);

      // 粒子动画
      let lastT = performance.now();
      let startT = performance.now();
      function frame(now) {
        const dt = Math.min(0.05, (now - lastT) / 1000);
        lastT = now;
        const elapsed = now - startT;
        ctx.clearRect(0, 0, W, H);

        rings.forEach(ring => {
          ring.prog += dt * 1.2;
          const r = 20 + (ring.maxR - 20) * Math.min(1, ring.prog);
          const a = Math.max(0, 1 - ring.prog) * 0.7;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(${ring.color},${a})`;
          ctx.lineWidth = ring.width * (1 - ring.prog * 0.5);
          ctx.shadowBlur = 30;
          ctx.shadowColor = `rgba(${ring.color},${a})`;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });

        particles = particles.filter(p => {
          p.update(dt * 60);
          if (!p.dead) { p.draw(ctx); return true; }
          return false;
        });

        if (elapsed < 1500 || particles.length > 0) {
          requestAnimationFrame(frame);
        } else {
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        }
      }
      requestAnimationFrame(frame);
    }, 500);

    // ===== 阶段4：镜头拉回（1200ms后） =====
    setTimeout(() => {
      stage.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.3, 1)';
      stage.style.transform = '';
      petFighter.style.filter = '';
    }, 1500);
  }

  window.SkillFX = { play: playSkillEffect };
})();
