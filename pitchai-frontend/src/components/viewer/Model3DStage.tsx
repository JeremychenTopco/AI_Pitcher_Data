import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { usePlayback } from "@/playback/PlaybackContext";
import type { PoseData } from "@/api/dataSource";
import { normalizeJoint } from "./PitchViewer";

const MODEL_URL = "/models/CesiumMan.glb";

/**
 * Which model bone gets aimed at which pair of this app's own joints, and —
 * for each — the bone's own child (used once, at load time, to read that
 * bone's bind-pose "pointing direction" before any retargeting is applied).
 * Names are CesiumMan's own node names; a different model needs a different
 * table. Listed in topological order (a bone's driving parent always appears
 * above it) because retargeting walks this list top-down, refreshing world
 * matrices as it goes — a child's target direction depends on its parent's
 * *already-updated* world rotation.
 *
 * Root: rather than solve a full pelvis basis (twist + tilt) from just four
 * points, the root bone is aimed the same single-direction way as everything
 * else, using pelvis→neck as "up" — this captures the torso's forward/lateral
 * lean, which is most of what's visually interesting in a pitch, but not
 * pelvis rotation about the vertical axis (hip-shoulder separation). A
 * deliberate simplification for a first pass, not an oversight.
 *
 * Ankles and wrists are left at their bind rotation — this app's pose data
 * has no foot or hand orientation to drive them with.
 */
const AIM_BONES: Array<{ bone: string; child: string; from: string; to: string }> = [
  { bone: "Skeleton_torso_joint_1", child: "Skeleton_torso_joint_2", from: "pelvis", to: "neck" },
  { bone: "Skeleton_neck_joint_1", child: "Skeleton_neck_joint_2", from: "neck", to: "head" },
  { bone: "Skeleton_arm_joint_R", child: "Skeleton_arm_joint_R__2_", from: "rshoulder", to: "relbow" },
  { bone: "Skeleton_arm_joint_R__2_", child: "Skeleton_arm_joint_R__3_", from: "relbow", to: "rwrist" },
  { bone: "Skeleton_arm_joint_L__4_", child: "Skeleton_arm_joint_L__3_", from: "lshoulder", to: "lelbow" },
  { bone: "Skeleton_arm_joint_L__3_", child: "Skeleton_arm_joint_L__2_", from: "lelbow", to: "lwrist" },
  { bone: "leg_joint_R_1", child: "leg_joint_R_2", from: "rhip", to: "rknee" },
  { bone: "leg_joint_R_2", child: "leg_joint_R_3", from: "rknee", to: "rankle" },
  { bone: "leg_joint_L_1", child: "leg_joint_L_2", from: "lhip", to: "lknee" },
  { bone: "leg_joint_L_2", child: "leg_joint_L_3", from: "lknee", to: "lankle" },
];

function findJoint(pose: PoseData, joints: Array<[number, number, number]>, name: string): THREE.Vector3 | null {
  const i = pose.jointNames.findIndex((n) => normalizeJoint(n) === name);
  if (i < 0) return null;
  const [x, y, z] = joints[i];
  return new THREE.Vector3(x, y, z);
}

/** Root and a leg bone, used to scale/anchor the joint-skeleton overlay onto the model — see SkeletonOverlay. */
const ROOT_BONE = "Skeleton_torso_joint_1";
const SCALE_REF_BONE = "leg_joint_R_3";

/** One-time bind-pose measurement of the loaded model, used to place both the model's root translation and the joint-skeleton overlay in the same world units. */
interface BindMeasure {
  anchor: THREE.Vector3;
  scale: number;
}

/**
 * This app's joint data is pelvis-relative — pelvis sits at the origin in
 * every frame — so there is no recorded translation to drive the model
 * across the ground with. This derives a plausible one: whichever ankle
 * sits lower (closer to the ground) each frame is treated as the planted
 * foot, and the root is shifted frame-to-frame by exactly that foot's own
 * relative movement, so its world position stays fixed while it's down —
 * a per-frame foot lock, not a physical simulation. That naturally produces
 * a pivot around the back foot during leg lift and a shift onto the front
 * foot once it plants, which is most of what a stride looks like. Computed
 * once per pose (frame lookups are then O(1)) since scrubbing the timeline
 * jumps frames out of order, not just forward.
 *
 * The source CSVs behind this app's OBP fixtures (see
 * scripts/obp_to_fixture.mjs) do carry the real lab-frame pelvis trajectory
 * before it gets zeroed out into this pelvis-relative form — a future
 * converter pass could thread that through as a per-frame `root` field
 * instead of reconstructing it here. This heuristic is what's derivable
 * from the data actually shipped today.
 */
function computeFootLockOffsets(pose: PoseData): THREE.Vector3[] {
  const rIdx = pose.jointNames.findIndex((n) => normalizeJoint(n) === "rankle");
  const lIdx = pose.jointNames.findIndex((n) => normalizeJoint(n) === "lankle");
  const offsets: THREE.Vector3[] = [new THREE.Vector3()];
  for (let t = 1; t < pose.frames.length; t++) {
    const next = offsets[t - 1].clone();
    if (rIdx >= 0 && lIdx >= 0) {
      const prev = pose.frames[t - 1].joints3d;
      const curr = pose.frames[t].joints3d;
      const idx = curr[rIdx][1] <= curr[lIdx][1] ? rIdx : lIdx;
      next.x += prev[idx][0] - curr[idx][0];
      next.z += prev[idx][2] - curr[idx][2];
    }
    offsets.push(next);
  }
  return offsets;
}

/** Net ground-plane heading of the foot-lock drift above — i.e. mound→plate, for the direction arrow. Falls back to a fixed heading when a pose barely moves (too short a clip, or no ankle data). */
function computePitchDirection(offsets: THREE.Vector3[]): THREE.Vector3 {
  const net = offsets[offsets.length - 1]?.clone() ?? new THREE.Vector3();
  net.y = 0;
  return net.lengthSq() > 1e-6 ? net.normalize() : new THREE.Vector3(0, 0, 1);
}

/**
 * Draws this pitch's own joints (dots) and bones (lines) *inside the same
 * three.js scene as the model*, rather than as a separately-aligned 2D
 * overlay — that's what makes it a true "bind together," not two cameras
 * that happen to look similar. This app's joint data is pelvis-relative and
 * normalized by leg length (see the OBP/synthetic converters), so it's
 * anchored at the model's own root-bone world position and rescaled by the
 * model's own hip→ankle world distance — both taken from a `BindMeasure`
 * read once, at bind pose, right after load (before any retargeting
 * rotation or root translation), since bones only ever rotate in place
 * here, so that bind reading stays valid for every later frame; per-frame
 * root translation (see computeFootLockOffsets) is added back in on top of
 * it at `update()` time instead, in the same unitless pose units.
 */
class SkeletonOverlay {
  private readonly group: THREE.Group;
  private readonly joints: THREE.Mesh[];
  private readonly lines: THREE.LineSegments;
  private readonly anchor: THREE.Vector3;
  private readonly scale: number;

  constructor(scene: THREE.Scene, pose: PoseData, bind: BindMeasure) {
    this.anchor = bind.anchor.clone();
    this.scale = bind.scale;

    const jointGeom = new THREE.SphereGeometry(0.018, 8, 6);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x22e06a });
    this.joints = pose.jointNames.map(() => new THREE.Mesh(jointGeom, jointMat));

    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(pose.bones.length * 2 * 3), 3),
    );
    this.lines = new THREE.LineSegments(lineGeom, new THREE.LineBasicMaterial({ color: 0x22e06a }));

    this.group = new THREE.Group();
    this.joints.forEach((m) => this.group.add(m));
    this.group.add(this.lines);
    scene.add(this.group);
  }

  update(pose: PoseData, joints3d: Array<[number, number, number]>, rootOffset: THREE.Vector3) {
    const origin = this.anchor.clone().add(rootOffset.clone().multiplyScalar(this.scale));
    const world = joints3d.map(([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(this.scale).add(origin));
    world.forEach((p, i) => this.joints[i]?.position.copy(p));
    const pos = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    pose.bones.forEach(([a, b], i) => {
      pos.setXYZ(i * 2, world[a].x, world[a].y, world[a].z);
      pos.setXYZ(i * 2 + 1, world[b].x, world[b].y, world[b].z);
    });
    pos.needsUpdate = true;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.joints[0]?.geometry.dispose();
    (this.joints[0]?.material as THREE.Material | undefined)?.dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

/**
 * Rotates each bone in AIM_BONES so its bind-pose "pointing direction"
 * (toward its own child) now points toward the live `from → to` joint pair
 * instead — a per-bone aim constraint, not inverse kinematics. It only ever
 * needs *directions*, never absolute positions or bone lengths, so it
 * doesn't matter that this app's joint data is unitless (normalized by leg
 * length) while the model's bones are in real-world meters.
 */
function retarget(
  bones: Map<string, THREE.Object3D>,
  bindDirs: Map<string, THREE.Vector3>,
  pose: PoseData,
  joints: Array<[number, number, number]>,
) {
  const parentWorldQuat = new THREE.Quaternion();
  for (const { bone: boneName, from, to } of AIM_BONES) {
    const bone = bones.get(boneName);
    const bindDir = bindDirs.get(boneName);
    if (!bone || !bindDir || !bone.parent) continue;
    const a = findJoint(pose, joints, from);
    const b = findJoint(pose, joints, to);
    if (!a || !b) continue;

    const targetWorldDir = b.sub(a).normalize();
    bone.parent.getWorldQuaternion(parentWorldQuat);
    const targetLocalDir = targetWorldDir.applyQuaternion(parentWorldQuat.invert()).normalize();
    bone.quaternion.setFromUnitVectors(bindDir, targetLocalDir);
    bone.updateMatrixWorld();
  }
}

interface Props {
  className?: string;
  /** This pitch's skeleton — when given, the model is retargeted to it every frame instead of playing its own animation. */
  pose?: PoseData | null;
  /** Fixed front-on camera, no orbit — for compositing under the flat 2D skeleton view. Defaults to a free orbit camera. */
  locked?: boolean;
}

/**
 * A real skinned 3D body model (three.js), retargeted frame-by-frame onto
 * this app's own joint-center data when `pose` is given — see `retarget()`
 * above for exactly how, and its limits (no pelvis twist, no foot/hand
 * orientation). Without `pose` it falls back to playing its own built-in
 * walk animation, as a standalone preview.
 *
 * This is a procedural approximation, not motion capture retargeting with
 * IK — good enough to judge whether a skinned-mesh look is worth it over the
 * stick-figure skeleton, not a biomechanically exact rendering.
 *
 * Model: "CesiumMan" from the Khronos glTF-Sample-Assets repo, © Cesium /
 * Analytical Graphics Inc, CC BY 4.0 — https://github.com/KhronosGroup/glTF-Sample-Assets
 */
export function Model3DStage({ className = "", pose = null, locked = false }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const { frame } = usePlayback();
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const poseRef = useRef(pose);
  poseRef.current = pose;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    if (locked) camera.position.set(0, 1.1, 3.2);
    else camera.position.set(2.2, 1.6, 2.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: locked });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1.2);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 3);
    scene.add(key);

    if (!locked) scene.add(new THREE.GridHelper(4, 16, 0x2a2a2a, 0x2a2a2a));

    const controls = locked ? null : new OrbitControls(camera, renderer.domElement);
    if (controls) {
      controls.target.set(0, 0.9, 0);
      controls.enableDamping = true;
      controls.minDistance = 1;
      controls.maxDistance = 8;
      controls.update();
    } else {
      camera.lookAt(0, 1.1, 0);
    }

    let mixer: THREE.AnimationMixer | null = null;
    let bones: Map<string, THREE.Object3D> | null = null;
    let bindDirs: Map<string, THREE.Vector3> | null = null;
    let skeleton: SkeletonOverlay | null = null;
    let bind: BindMeasure | null = null;
    let pitchArrow: THREE.ArrowHelper | null = null;
    // Wraps gltf.scene so the model can be shifted across the ground by
    // foot-lock translation without touching any bone — retarget() only
    // ever rotates bones in place, see its own comment for why.
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    let footLock: { pose: PoseData | null; offsets: THREE.Vector3[] } = { pose: null, offsets: [] };

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        modelGroup.add(gltf.scene);

        bones = new Map();
        gltf.scene.traverse((obj) => {
          if (obj.name) bones!.set(obj.name, obj);
        });
        bindDirs = new Map();
        for (const { bone, child } of AIM_BONES) {
          const childBone = bones.get(child);
          if (childBone) bindDirs.set(bone, childBone.position.clone().normalize());
        }

        const rootBone = bones.get(ROOT_BONE);
        const refBone = bones.get(SCALE_REF_BONE);
        const anchor = new THREE.Vector3();
        const refPos = new THREE.Vector3();
        rootBone?.getWorldPosition(anchor);
        refBone?.getWorldPosition(refPos);
        bind = { anchor, scale: rootBone && refBone ? anchor.distanceTo(refPos) : 1 };

        // Bound together, not just visually similar — only for the free-orbit
        // 3D case. The locked (2D-backdrop) case already gets its own aligned
        // overlay for free, drawn as flat SVG on top by the caller.
        if (!locked && poseRef.current) skeleton = new SkeletonOverlay(scene, poseRef.current, bind);

        if (!poseRef.current && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(gltf.scene);
          mixer.clipAction(gltf.animations[0]).play();
        }
        setStatus("ready");
      },
      undefined,
      () => !disposed && setStatus("error"),
    );

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const currentPose = poseRef.current;
      if (bones && bindDirs && currentPose) {
        const frameIdx = Math.min(frameRef.current, currentPose.frames.length - 1);
        const joints = currentPose.frames[frameIdx]?.joints3d;
        if (joints) {
          retarget(bones, bindDirs, currentPose, joints);

          if (footLock.pose !== currentPose) {
            footLock = { pose: currentPose, offsets: computeFootLockOffsets(currentPose) };
            if (!locked && bind) {
              const dir = computePitchDirection(footLock.offsets);
              const origin = new THREE.Vector3(bind.anchor.x, 0.01, bind.anchor.z);
              if (!pitchArrow) {
                pitchArrow = new THREE.ArrowHelper(dir, origin, 1.2, 0xffcc33, 0.32, 0.16);
                scene.add(pitchArrow);
              } else {
                pitchArrow.position.copy(origin);
                pitchArrow.setDirection(dir);
              }
            }
          }
          const offset = footLock.offsets[frameIdx] ?? new THREE.Vector3();
          if (!locked && bind) modelGroup.position.set(offset.x * bind.scale, 0, offset.z * bind.scale);
          if (!skeleton && !locked && bind) skeleton = new SkeletonOverlay(scene, currentPose, bind);
          skeleton?.update(currentPose, joints, offset);
        }
      } else {
        mixer?.update(clock.getDelta());
      }
      controls?.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls?.dispose();
      skeleton?.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pose/frame are read live via refs so the WebGL context isn't torn down every frame; only `locked` should ever re-init it.
  }, [locked]);

  return (
    <div className={`relative overflow-hidden ${locked ? "" : "bg-black"} ${className}`}>
      <div
        ref={mountRef}
        className={`size-full ${locked ? "" : "cursor-grab touch-none active:cursor-grabbing"}`}
      />
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">載入模型中…</div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">模型載入失敗</div>
      )}
      {!locked && (
        <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/45 px-2 py-1 text-[10px] font-medium text-white/80 backdrop-blur-sm">
          {pose ? "測試用人體模型（近似姿態）" : "測試模型（非本次投球資料）"} · CesiumMan CC BY 4.0
          {pose && (
            <>
              {" "}
              · <span style={{ color: "#ffcc33" }}>➔</span> 投球方向
            </>
          )}
        </div>
      )}
    </div>
  );
}
