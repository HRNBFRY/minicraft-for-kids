import { CFG, B, BLOCK_DEFS, DIM } from './constants.js';

/* ---------------- Player: 一人称・物理・クリエイティブ飛行 ---------------- */
export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(256.5, 80, 256.5);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.flying = false;
    this.onGround = false;
    this.R = 0.3;
    this.H = 1.8;
    this.EYE = 1.62;
  }
  spawn() {
    let sx = 256, sz = 256;
    search: for (let r = 0; r < 250; r += 2) {
      const cands = [[256 + r, 256], [256 - r, 256], [256, 256 + r], [256, 256 - r]];
      for (let i = 0; i < 4; i++) {
        this.world.columnInto(cands[i][0], cands[i][1]);
        if (this.world.colH > this.world.terrain.sea + 1) { sx = cands[i][0]; sz = cands[i][1]; break search; }
      }
    }
    this.world.columnInto(sx, sz);
    this.pos.set(sx + 0.5, this.world.colH + 2, sz + 0.5);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = -0.1;
    this.flying = false;
  }
  isSolid(x, y, z) { return BLOCK_DEFS[this.world.getBlock(x, y, z)].solid; }
  inLiquid() {
    const id = this.world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    return BLOCK_DEFS[id].liquid;
  }
  intersectsBlock(bx, by, bz) {
    const p = this.pos, r = this.R;
    return bx + 1 > p.x - r && bx < p.x + r &&
           by + 1 > p.y && by < p.y + this.H &&
           bz + 1 > p.z - r && bz < p.z + r;
  }
  // ctl: {f, s, jump, down} キーボードとゲームパッドを統合した操作値
  update(dt, ctl) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
    let mx = fx * ctl.f + sx * ctl.s, mz = fz * ctl.f + sz * ctl.s;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    const water = this.inLiquid();
    const speed = this.flying ? CFG.SPEED_FLY : (water ? CFG.SPEED_WATER : CFG.SPEED_WALK);
    const k = 1 - Math.exp(-(this.flying || this.onGround ? 12 : 4) * dt);
    this.vel.x += (mx * speed - this.vel.x) * k;
    this.vel.z += (mz * speed - this.vel.z) * k;

    if (this.flying) {
      let ty = 0;
      if (ctl.jump) ty = 9;
      if (ctl.down) ty = -9;
      this.vel.y += (ty - this.vel.y) * (1 - Math.exp(-12 * dt));
    } else if (water) {
      this.vel.y -= 10 * dt;
      if (ctl.jump) this.vel.y = Math.min(this.vel.y + 34 * dt, 4);
      if (this.vel.y < -4) this.vel.y = -4;
    } else {
      this.vel.y -= CFG.GRAVITY * dt;
      if (this.vel.y < -40) this.vel.y = -40;
      if (ctl.jump && this.onGround) this.vel.y = 8.6;
    }

    this.onGround = false;
    this.pos.x += this.vel.x * dt; this.resolve(0);
    this.pos.y += this.vel.y * dt; this.resolve(1);
    this.pos.z += this.vel.z * dt; this.resolve(2);

    this.pos.x = Math.max(0.31, Math.min(CFG.WORLD_SIZE - 0.31, this.pos.x));
    this.pos.z = Math.max(0.31, Math.min(CFG.WORLD_SIZE - 0.31, this.pos.z));
    if (this.world.dim === DIM.END) {
      if (this.pos.y < -60) this.pos.y = -60;
    } else if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; }
    if (this.pos.y > CFG.HEIGHT + 40) { this.pos.y = CFG.HEIGHT + 40; this.vel.y = 0; }
  }
  resolve(axis) {
    const r = this.R, h = this.H, p = this.pos, EPS = 0.001;
    const minX = Math.floor(p.x - r), maxX = Math.floor(p.x + r);
    const minY = Math.floor(p.y), maxY = Math.floor(p.y + h);
    const minZ = Math.floor(p.z - r), maxZ = Math.floor(p.z + r);
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++) {
          if (!this.isSolid(x, y, z)) continue;
          if (axis === 0) {
            p.x = this.vel.x > 0 ? x - r - EPS : x + 1 + r + EPS;
            this.vel.x = 0;
          } else if (axis === 1) {
            if (this.vel.y > 0) p.y = y - h - EPS;
            else { p.y = y + 1; this.onGround = true; }
            this.vel.y = 0;
          } else {
            p.z = this.vel.z > 0 ? z - r - EPS : z + 1 + r + EPS;
            this.vel.z = 0;
          }
          return;
        }
  }
  updateCamera(camera) {
    camera.position.set(this.pos.x, this.pos.y + this.EYE, this.pos.z);
    camera.rotation.x = this.pitch;
    camera.rotation.y = this.yaw;
  }
}
