import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MAX_VERTEX_COUNT = 180000;

export function useThreePreview(stlData?: ArrayBuffer) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const frameRef = useRef<number | null>(null);
  const stlLoaderRef = useRef(new STLLoader());
  const pmremRef = useRef<THREE.PMREMGenerator | null>(null);
  const [isLoadingMesh, setIsLoadingMesh] = useState(false);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe2e8f0);
    scene.fog = new THREE.Fog(0xe2e8f0, 180, 860);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      2400,
    );
    camera.position.set(80, 50, 80);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    pmremRef.current = pmremGenerator;

    const fallbackEnv = pmremGenerator.fromScene(new RoomEnvironment(), 0.02).texture;
    scene.environment = fallbackEnv;

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
    keyLight.position.set(90, 110, 70);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-80, 40, -55);
    scene.add(fillLight);

    const gridHelper = new THREE.GridHelper(240, 24, 0x64748b, 0x94a3b8);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(60);
    scene.add(axesHelper);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 5;
    controls.maxDistance = 1500;
    controls.minPolarAngle = 0.1;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controlsRef.current = controls;

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) {
        return;
      }
      const { clientWidth, clientHeight } = mountRef.current;
      cameraRef.current.aspect = clientWidth / clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(clientWidth, clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      if (meshRef.current) {
        disposeMesh(scene, meshRef.current);
        meshRef.current = null;
      }

      controls.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
      pmremGenerator.dispose();
      scene.environment = null;
    };
  }, []);

  useEffect(() => {
    if (!stlData || !sceneRef.current || !cameraRef.current || !controlsRef.current) {
      return;
    }

    setIsLoadingMesh(true);

    try {
      const parsedGeometry = stlLoaderRef.current.parse(stlData);
      const geometry = downsampleGeometry(parsedGeometry, MAX_VERTEX_COUNT);
      geometry.computeVertexNormals();
      geometry.center();

      const material = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        metalness: 0.44,
        roughness: 0.28,
        envMapIntensity: 0.38,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (meshRef.current) {
        disposeMesh(sceneRef.current, meshRef.current);
      }

      sceneRef.current.add(mesh);
      meshRef.current = mesh;

      fitCameraToMesh(cameraRef.current, controlsRef.current, mesh);
    } catch (error) {
      console.error('STL解析失败:', error);
    } finally {
      setIsLoadingMesh(false);
    }
  }, [stlData]);

  return {
    mountRef,
    isLoadingMesh,
  };
}

function fitCameraToMesh(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  mesh: THREE.Mesh,
) {
  const bounds = new THREE.Box3().setFromObject(mesh);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = camera.fov * (Math.PI / 180);
  const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.45;

  camera.near = Math.max(distance / 150, 0.05);
  camera.far = distance * 200;
  camera.position.set(center.x + distance, center.y + distance * 0.7, center.z + distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function downsampleGeometry(
  geometry: THREE.BufferGeometry,
  maxVertexCount: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || position.count <= maxVertexCount) {
    return geometry;
  }

  // 仅保留部分三角面来控制顶点规模，优先保证交互流畅。
  const triangles = Math.floor(position.count / 3);
  const maxTriangles = Math.max(1, Math.floor(maxVertexCount / 3));
  const stride = Math.max(1, Math.ceil(triangles / maxTriangles));

  const sampled: number[] = [];
  for (let tri = 0; tri < triangles; tri += stride) {
    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
      const idx = (tri * 3 + vertexOffset) * 3;
      sampled.push(
        position.array[idx] as number,
        position.array[idx + 1] as number,
        position.array[idx + 2] as number,
      );
    }
  }

  const simplified = new THREE.BufferGeometry();
  simplified.setAttribute('position', new THREE.Float32BufferAttribute(sampled, 3));
  simplified.computeVertexNormals();

  geometry.dispose();
  return simplified;
}

function disposeMesh(scene: THREE.Scene, mesh: THREE.Mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material.dispose());
  } else {
    mesh.material.dispose();
  }
}
