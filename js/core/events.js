/* ---------------- EventScheduler: world.json の specialEvents をデータ駆動で実行 ----------------
 * 現状のビルトインは "meteorShower"（見た目だけの流星群）。
 * 新しい特殊イベントを追加する場合は BUILTIN_EVENTS にハンドラを1つ足すだけでよい。
 */
const BUILTIN_EVENTS = {
  meteorShower: {
    start(ctx) {
      const COUNT = ctx.def.count || 16;
      const group = new THREE.Group();
      for (let i = 0; i < COUNT; i++) {
        const geo = new THREE.SphereGeometry(0.25 + Math.random() * 0.3, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(
          ctx.center.x + (Math.random() - 0.5) * 60,
          40 + Math.random() * 20,
          ctx.center.z + (Math.random() - 0.5) * 60
        );
        m.userData.vy = -(8 + Math.random() * 6);
        group.add(m);
      }
      ctx.scene.add(group);
      ctx.state.group = group;
    },
    tick(ctx, dt) {
      const g = ctx.state.group;
      if (!g) return;
      for (const m of g.children) {
        m.position.y += m.userData.vy * dt;
        if (m.position.y < 0) m.position.y = 40 + Math.random() * 20;
      }
    },
    end(ctx) {
      if (ctx.state.group) {
        ctx.scene.remove(ctx.state.group);
        ctx.state.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        ctx.state.group = null;
      }
    }
  }
};

export class EventScheduler {
  constructor(scene, defs) {
    this.scene = scene;
    this.defs = defs || [];
    this.runtime = this.defs.map(def => ({
      def, t: def.intervalSec || 60, active: false, activeT: 0, state: {}
    }));
  }
  update(dt, center) {
    for (const rt of this.runtime) {
      const handler = BUILTIN_EVENTS[rt.def.type];
      if (!handler) continue;
      if (rt.active) {
        rt.activeT += dt;
        handler.tick({ def: rt.def, scene: this.scene, center, state: rt.state }, dt);
        if (rt.activeT >= (rt.def.durationSec || 6)) {
          handler.end({ def: rt.def, scene: this.scene, center, state: rt.state });
          rt.active = false;
          rt.t = rt.def.intervalSec || 60;
        }
      } else {
        rt.t -= dt;
        if (rt.t <= 0) {
          rt.active = true; rt.activeT = 0;
          handler.start({ def: rt.def, scene: this.scene, center, state: rt.state });
        }
      }
    }
  }
}
