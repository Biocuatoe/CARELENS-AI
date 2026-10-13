import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";

export interface ContactShadowOptions {
  /** Cạnh mặt sàn (mm), đặt quanh tâm `x`, `z` của nhóm. */
  size: number;
  /** Khoảng cao (mm) mà bóng còn thấy: vật cao hơn mặt sàn bấy nhiêu thì không đổ bóng. Bóng nhạt dần theo độ cao. */
  height: number;
  /** Độ phân giải texture bóng (px). */
  resolution: number;
  /** Độ đậm tối đa của bóng (0–1). */
  darkness: number;
  /** Độ nhoè (texel). */
  blur: number;
}

/**
 * Bóng tiếp xúc mềm trên mặt sàn vô hình (kỹ thuật "contact shadow" của ví dụ three.js): vẽ độ sâu cảnh nhìn từ dưới sàn lên
 * vào một texture nhỏ, làm nhoè hai lượt, rồi trải lên một mặt phẳng trong suốt. Chỉ chạy khi khung hình được vẽ (cảnh vẽ theo yêu cầu),
 * tốn một lượt vẽ độ sâu ở độ phân giải thấp. Kèm một vầng sáng sàn rất nhẹ để bóng đọc được trên nền tối.
 */
export class ContactShadow {
  readonly group = new Group();
  private readonly target: WebGLRenderTarget;
  private readonly targetBlur: WebGLRenderTarget;
  private readonly camera: OrthographicCamera;
  private readonly plane: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly pool: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly blurPlane: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly depthMaterial: MeshDepthMaterial;
  private readonly hBlur: ShaderMaterial;
  private readonly vBlur: ShaderMaterial;
  private readonly geometry: PlaneGeometry;
  private readonly poolTexture: CanvasTexture;

  constructor(private readonly options: ContactShadowOptions) {
    const { size, height, resolution } = options;
    this.group.name = "ground";
    this.target = new WebGLRenderTarget(resolution, resolution);
    this.target.texture.generateMipmaps = false;
    this.targetBlur = new WebGLRenderTarget(resolution, resolution);
    this.targetBlur.texture.generateMipmaps = false;

    this.geometry = new PlaneGeometry(size, size).rotateX(Math.PI / 2);

    // Vầng sáng sàn: gradient tròn rất nhẹ (vẽ bằng canvas 128 px, không tải ảnh).
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(242,240,233,0.10)");
      g.addColorStop(0.45, "rgba(242,240,233,0.045)");
      g.addColorStop(1, "rgba(242,240,233,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    this.poolTexture = new CanvasTexture(canvas);
    this.poolTexture.colorSpace = SRGBColorSpace;
    this.pool = new Mesh(this.geometry, new MeshBasicMaterial({ map: this.poolTexture, transparent: true, depthWrite: false, toneMapped: false }));
    this.pool.scale.set(0.62, -1, 0.62); // y = −1: lật pháp tuyến cho mặt phẳng hướng lên.
    this.pool.position.y = -0.04;
    this.pool.renderOrder = -2;
    this.group.add(this.pool);

    this.plane = new Mesh(this.geometry, new MeshBasicMaterial({ map: this.target.texture, transparent: true, depthWrite: false, opacity: 1 }));
    this.plane.renderOrder = -1;
    // Texture được vẽ từ camera nhìn lên nên lật trục để khớp với sàn.
    this.plane.scale.y = -1;
    this.group.add(this.plane);

    this.blurPlane = new Mesh(this.geometry, new ShaderMaterial());
    this.blurPlane.visible = false;
    this.group.add(this.blurPlane);

    this.camera = new OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
    this.camera.rotation.x = Math.PI / 2;
    this.group.add(this.camera);

    this.depthMaterial = new MeshDepthMaterial();
    const darkness = { value: options.darkness };
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = darkness;
      shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
        "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );",
      )}`;
    };
    this.depthMaterial.depthTest = false;
    this.depthMaterial.depthWrite = false;

    this.hBlur = new ShaderMaterial(HorizontalBlurShader);
    this.hBlur.depthTest = false;
    this.vBlur = new ShaderMaterial(VerticalBlurShader);
    this.vBlur.depthTest = false;
  }

  /** Vẽ lại texture bóng. Gọi ngay trước khi vẽ khung hình chính. */
  update(renderer: WebGLRenderer, scene: Scene): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevBackground = scene.background;
    const prevOverride = scene.overrideMaterial;
    const groupVisible = this.group.visible;
    this.group.visible = false;
    scene.background = null;
    scene.overrideMaterial = this.depthMaterial;
    renderer.setClearAlpha(0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    this.group.updateMatrixWorld(true);
    renderer.render(scene, this.camera);
    scene.overrideMaterial = prevOverride;
    this.group.visible = groupVisible;

    this.blur(renderer, this.options.blur);
    this.blur(renderer, this.options.blur * 0.4);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevAlpha);
    scene.background = prevBackground;
  }

  private blur(renderer: WebGLRenderer, amount: number): void {
    const texel = amount / this.options.resolution;
    this.blurPlane.visible = true;
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse!.value = this.target.texture;
    this.hBlur.uniforms.h!.value = texel;
    renderer.setRenderTarget(this.targetBlur);
    renderer.render(this.blurPlane, this.camera);
    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse!.value = this.targetBlur.texture;
    this.vBlur.uniforms.v!.value = texel;
    renderer.setRenderTarget(this.target);
    renderer.render(this.blurPlane, this.camera);
    this.blurPlane.visible = false;
  }

  dispose(): void {
    this.target.dispose();
    this.targetBlur.dispose();
    this.geometry.dispose();
    this.plane.material.dispose();
    this.pool.material.dispose();
    this.poolTexture.dispose();
    this.depthMaterial.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
    this.group.removeFromParent();
  }
}
