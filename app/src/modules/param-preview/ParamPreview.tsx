import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface ParamPreviewProps {
  stlData?: string; // Base64编码的STL数据
  parameters: Record<string, any>;
  onParameterChange: (parameters: Record<string, any>) => void;
}

export const ParamPreview: React.FC<ParamPreviewProps> = ({
  stlData,
  parameters,
  onParameterChange
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;

    // 初始化Three.js场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    // 设置相机
    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(50, 50, 50);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // 设置渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 添加光源
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(50, 50, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // 添加网格
    const gridHelper = new THREE.GridHelper(100, 10);
    scene.add(gridHelper);

    // 添加坐标轴
    const axesHelper = new THREE.AxesHelper(50);
    scene.add(axesHelper);

    // 鼠标控制
    let mouseX = 0;
    let mouseY = 0;
    let isMouseDown = false;

    const handleMouseMove = (event: MouseEvent) => {
      if (!isMouseDown) return;
      mouseX = (event.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    const handleMouseDown = () => {
      isMouseDown = true;
    };

    const handleMouseUp = () => {
      isMouseDown = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    // 动画循环
    const animate = () => {
      requestAnimationFrame(animate);

      if (meshRef.current && isMouseDown) {
        meshRef.current.rotation.y = mouseX * Math.PI;
        meshRef.current.rotation.x = mouseY * Math.PI;
      }

      renderer.render(scene, camera);
    };
    animate();

    // 处理窗口大小变化
    const handleResize = () => {
      if (!mountRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('resize', handleResize);
      
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (!stlData || !sceneRef.current) return;

    setIsLoading(true);

    // 模拟STL加载
    setTimeout(() => {
      // 创建简单的几何体作为演示
      const geometry = new THREE.BoxGeometry(
        parameters.length || 30,
        parameters.height || 20,
        parameters.width || 30
      );
      
      const material = new THREE.MeshPhongMaterial({
        color: 0x00ff00,
        wireframe: false
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // 移除旧的网格
      if (meshRef.current && sceneRef.current) {
        sceneRef.current.remove(meshRef.current);
      }

      if (sceneRef.current) {
        sceneRef.current.add(mesh);
      }
      meshRef.current = mesh;
      setIsLoading(false);
    }, 500);
  }, [stlData, parameters]);

  const handleParameterChange = (paramName: string, value: any) => {
    const newParameters = { ...parameters, [paramName]: value };
    onParameterChange(newParameters);
  };

  return (
    <div className="param-preview-module">
      <h3>参数化预览</h3>
      
      <div className="preview-container">
        <div ref={mountRef} className="three-canvas" />
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner">加载中...</div>
          </div>
        )}
      </div>

      <div className="parameters-panel">
        <h4>参数控制</h4>
        {Object.entries(parameters).map(([name, value]) => (
          <div key={name} className="parameter-control">
            <label>{name}:</label>
            <input
              type={typeof value === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => {
                const newValue = typeof value === 'number' 
                  ? parseFloat(e.target.value) || 0
                  : e.target.value;
                handleParameterChange(name, newValue);
              }}
              className="parameter-input"
            />
          </div>
        ))}
      </div>
      
      <style jsx>{`
        .param-preview-module {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .preview-container {
          position: relative;
          width: 100%;
          height: 400px;
          border: 1px solid #ddd;
          border-radius: 8px;
          overflow: hidden;
        }

        .three-canvas {
          width: 100%;
          height: 100%;
        }

        .loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .loading-spinner {
          font-size: 18px;
          color: #333;
        }

        .parameters-panel {
          background: #f5f5f5;
          padding: 15px;
          border-radius: 8px;
        }

        .parameter-control {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          gap: 10px;
        }

        .parameter-control label {
          min-width: 80px;
          font-weight: bold;
        }

        .parameter-input {
          flex: 1;
          padding: 5px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};
