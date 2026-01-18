/**
 * RBMK-1000 3D Model Exporter - Main Module
 * 
 * This is the main entry point that initializes the scene
 * and calls reactor component creation functions.
 */

// Global state
let engine, scene, camera;
let coreLayout = [];
let meshes = {
    // Active Zone
    graphiteBlocks: [],
    fuelChannels: [],
    controlRods: [],
    rodDisplacers: [],
    // Support structures
    supportCross: null,
    orShield: null,
    eShield: null,
    // Channel tracts (full-height technological channels)
    channelTracts: null,
    // Cooling and containment
    kzhCooling: null,
    lShell: null
};
let materials = {};

// DOM elements
const canvas = document.getElementById('renderCanvas');
const statusEl = document.getElementById('status');
const exportBtn = document.getElementById('exportBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');

/**
 * Initialize Babylon.js engine and scene
 * Uses WebGPU if available, falls back to WebGL2
 */
async function initEngine() {
    // Try WebGPU first for better performance
    const webGPUSupported = await BABYLON.WebGPUEngine.IsSupportedAsync;
    
    if (webGPUSupported) {
        console.log('WebGPU supported! Using WebGPU engine for maximum performance.');
        engine = new BABYLON.WebGPUEngine(canvas, {
            antialias: true,
            stencil: true,
            enableGPUDebugMarkers: false
        });
        await engine.initAsync();
        updateStatus('WebGPU engine initialized', 'success');
    } else {
        console.log('WebGPU not supported, falling back to WebGL2.');
        engine = new BABYLON.Engine(canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true
        });
        updateStatus('WebGL2 engine initialized (WebGPU not available)', '');
    }
    
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.1, 1);
    
    // Camera
    camera = new BABYLON.ArcRotateCamera(
        'camera',
        Math.PI / 4,
        Math.PI / 3,
        18,
        new BABYLON.Vector3(0, 2, 0),
        scene
    );
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 50;
    camera.minZ = 0.1;
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 50;
    
    // Lighting
    setupLighting();
    
    // Render loop
    engine.runRenderLoop(() => scene.render());
    
    // Resize handler
    window.addEventListener('resize', () => engine.resize());
}

/**
 * Setup scene lighting
 */
function setupLighting() {
    const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
    ambient.intensity = 0.6;
    ambient.diffuse = new BABYLON.Color3(1, 1, 1);
    ambient.groundColor = new BABYLON.Color3(0.3, 0.3, 0.35);
    
    const mainLight = new BABYLON.DirectionalLight('mainLight', new BABYLON.Vector3(-1, -2, -1), scene);
    mainLight.intensity = 0.8;
    
    const fillLight = new BABYLON.PointLight('fillLight', new BABYLON.Vector3(5, 10, 5), scene);
    fillLight.intensity = 0.4;
}

/**
 * Update status message
 */
function updateStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
}

/**
 * Update progress bar
 */
function updateProgress(percent) {
    progressBar.style.width = percent + '%';
}

/**
 * Initialize the reactor model
 */
async function initReactor() {
    updateStatus('Loading reactor layout...', '');
    
    try {
        // Create materials using ActiveZone module
        materials.activeZone = ActiveZone.createMaterials(scene);
        materials.supportCross = SupportCross.createMaterial(scene);
        materials.orShield = ORShield.createMaterials(scene);  // Use createMaterials for detailed version
        materials.eShield = EShield.createMaterials(scene);    // Upper biological shield materials
        materials.channelTracts = ChannelTracts.createMaterials(scene);  // Channel tract materials
        materials.kzhCooling = KZHCooling.createMaterials(scene);  // Cooling jacket materials
        materials.lShell = LShell.createMaterials(scene);  // Reactor shell materials
        
        // Load core layout
        coreLayout = await ActiveZone.loadLayout('ref.json');
        
        // Update stats display
        const stats = ActiveZone.getStats(coreLayout);
        document.getElementById('graphiteCount').textContent = stats.totalChannels;
        document.getElementById('fuelCount').textContent = stats.fuelChannels;
        document.getElementById('rodCount').textContent = stats.controlRods.total;
        
        // =====================
        // Create Support Cross (bottom-most structure)
        // =====================
        updateStatus('Creating support cross...', '');
        meshes.supportCross = SupportCross.create(scene, materials.supportCross);
        
        // =====================
        // Create OR Shield (lower biological shield)
        // =====================
        updateStatus('Creating OR shield...', '');
        progressContainer.style.display = 'block';
        
        // Create OR shield (shell + serpentinite fill)
        meshes.orShield = await ORShield.create(scene, coreLayout, materials.orShield, 0.01, updateProgress);
        
        // =====================
        // Create Active Zone
        // =====================
        updateStatus('Creating active zone...', '');
        
        const activeZoneMeshes = await ActiveZone.create(scene, coreLayout, materials.activeZone, (progress) => {
            updateProgress(progress);
        });
        
        meshes.graphiteBlocks = activeZoneMeshes.graphiteBlocks;
        meshes.fuelChannels = activeZoneMeshes.fuelChannels;
        meshes.controlRods = activeZoneMeshes.controlRods;
        meshes.rodDisplacers = activeZoneMeshes.rodDisplacers;
        
        // =====================
        // Create E Shield (upper biological shield - Схема "Е")
        // =====================
        updateStatus('Creating E shield (upper biological shield)...', '');
        
        meshes.eShield = await EShield.create(scene, coreLayout, materials.eShield, 0.01, updateProgress);
        
        // =====================
        // Create Channel Tracts (full-height technological channels)
        // =====================
        updateStatus('Creating channel tracts (technological channels)...', '');
        
        meshes.channelTracts = await ChannelTracts.create(scene, coreLayout, materials.channelTracts, 0.01, updateProgress);
        
        // =====================
        // Create KZH Cooling Jacket (Схема "КЖ")
        // =====================
        updateStatus('Creating KZH cooling jacket (Схема "КЖ")...', '');
        
        meshes.kzhCooling = await KZHCooling.create(scene, materials.kzhCooling, 0.01, updateProgress, coreLayout);
        
        // =====================
        // Create L Shell (Схема "Л" - Reactor Vessel)
        // =====================
        updateStatus('Creating L shell (Схема "Л" - reactor vessel)...', '');
        
        meshes.lShell = await LShell.create(scene, materials.lShell, 0.01, updateProgress);
        
        progressContainer.style.display = 'none';
        
        // Update mesh count
        const totalMeshes = meshes.graphiteBlocks.length + meshes.fuelChannels.length +
                           meshes.controlRods.length + meshes.rodDisplacers.length +
                           SupportCross.getMeshes(meshes.supportCross).length +
                           ORShield.getMeshes(meshes.orShield).length +
                           EShield.getMeshes(meshes.eShield).length +
                           ChannelTracts.getMeshes(meshes.channelTracts).length +
                           KZHCooling.getMeshes(meshes.kzhCooling).length +
                           LShell.getMeshes(meshes.lShell).length;
        document.getElementById('meshCount').textContent = totalMeshes;
        
        updateStatus('Model loaded successfully!', 'success');
        exportBtn.disabled = false;
        
    } catch (error) {
        updateStatus('Error: ' + error.message, 'error');
        console.error(error);
    }
}

/**
 * Export model to file
 */
async function exportModel() {
    const format = document.getElementById('exportFormat').value;
    const includeGraphite = document.getElementById('includeGraphite').checked;
    const includeFuel = document.getElementById('includeFuel').checked;
    const includeRods = document.getElementById('includeRods').checked;
    const includeSupport = document.getElementById('includeSupport')?.checked ?? true;
    
    updateStatus('Preparing export...', '');
    
    // Collect meshes to export
    const meshesToExport = [];
    
    if (includeGraphite) {
        meshesToExport.push(...meshes.graphiteBlocks);
    }
    
    if (includeFuel) {
        meshesToExport.push(...meshes.fuelChannels);
    }
    
    if (includeRods) {
        meshesToExport.push(...meshes.controlRods);
        meshesToExport.push(...meshes.rodDisplacers);
    }
    
    if (includeSupport) {
        // Add support cross
        if (meshes.supportCross) {
            meshesToExport.push(...SupportCross.getMeshes(meshes.supportCross));
        }
        // Add OR shield (lower biological shield)
        if (meshes.orShield) {
            meshesToExport.push(...ORShield.getMeshes(meshes.orShield));
        }
        // Add E shield (upper biological shield)
        if (meshes.eShield) {
            meshesToExport.push(...EShield.getMeshes(meshes.eShield));
        }
        // Add channel tracts (full-height technological channels)
        if (meshes.channelTracts) {
            meshesToExport.push(...ChannelTracts.getMeshes(meshes.channelTracts));
        }
        // Add KZH cooling jacket (Схема "КЖ")
        if (meshes.kzhCooling) {
            meshesToExport.push(...KZHCooling.getMeshes(meshes.kzhCooling));
        }
        // Add L shell (Схема "Л" - reactor vessel)
        if (meshes.lShell) {
            meshesToExport.push(...LShell.getMeshes(meshes.lShell));
        }
    }
    
    if (meshesToExport.length === 0) {
        updateStatus('No meshes selected for export!', 'error');
        return;
    }
    
    try {
        updateStatus(`Exporting ${meshesToExport.length} meshes...`, '');
        
        if (format === 'glb' || format === 'gltf') {
            // Export as GLTF/GLB
            const options = {
                shouldExportNode: (node) => {
                    if (meshesToExport.includes(node)) return true;
                    if (node.name && (node.name.includes('Template') || node.name.includes('template'))) {
                        return meshesToExport.some(m => m.sourceMesh === node);
                    }
                    return false;
                }
            };
            
            if (format === 'glb') {
                const glb = await BABYLON.GLTF2Export.GLBAsync(scene, 'rbmk_reactor', options);
                glb.downloadFiles();
            } else {
                const gltf = await BABYLON.GLTF2Export.GLTFAsync(scene, 'rbmk_reactor', options);
                gltf.downloadFiles();
            }
            
            updateStatus('Export complete! Check your downloads.', 'success');
        } else if (format === 'obj') {
            await exportToOBJ(meshesToExport);
        }
    } catch (error) {
        updateStatus('Export error: ' + error.message, 'error');
        console.error(error);
    }
}

/**
 * Export meshes to OBJ format
 */
async function exportToOBJ(meshesToExport) {
    const SCALE = ActiveZone.RBMK.SCALE;
    
    let objContent = '# RBMK-1000 Reactor Core Model\n';
    objContent += '# Exported from RBMK Simulator\n';
    objContent += '# Scale: 1 unit = 1 cm\n\n';
    
    let vertexOffset = 0;
    let processedMeshes = 0;
    
    progressContainer.style.display = 'block';
    
    for (const mesh of meshesToExport) {
        const sourceMesh = mesh.sourceMesh || mesh;
        const positions = sourceMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const indices = sourceMesh.getIndices();
        
        if (!positions || !indices) continue;
        
        objContent += `\n# ${mesh.name}\n`;
        objContent += `o ${mesh.name}\n`;
        
        const worldMatrix = mesh.getWorldMatrix();
        
        for (let i = 0; i < positions.length; i += 3) {
            const v = new BABYLON.Vector3(positions[i], positions[i + 1], positions[i + 2]);
            const transformed = BABYLON.Vector3.TransformCoordinates(v, worldMatrix);
            objContent += `v ${(transformed.x / SCALE).toFixed(4)} ${(transformed.y / SCALE).toFixed(4)} ${(transformed.z / SCALE).toFixed(4)}\n`;
        }
        
        for (let i = 0; i < indices.length; i += 3) {
            const i1 = indices[i] + 1 + vertexOffset;
            const i2 = indices[i + 1] + 1 + vertexOffset;
            const i3 = indices[i + 2] + 1 + vertexOffset;
            objContent += `f ${i1} ${i2} ${i3}\n`;
        }
        
        vertexOffset += positions.length / 3;
        processedMeshes++;
        
        const progress = (processedMeshes / meshesToExport.length) * 100;
        updateProgress(progress);
        
        if (processedMeshes % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    progressContainer.style.display = 'none';
    
    const blob = new Blob([objContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rbmk_reactor.obj';
    a.click();
    URL.revokeObjectURL(url);
    
    updateStatus('OBJ export complete! Check your downloads.', 'success');
}

/**
 * Reset camera to default view
 */
function resetCameraView() {
    camera.alpha = Math.PI / 4;
    camera.beta = Math.PI / 3;
    camera.radius = 18;
    camera.target = new BABYLON.Vector3(0, 2, 0);
}

/**
 * Set opacity for a material
 * @param {BABYLON.StandardMaterial} material - Material to modify
 * @param {number} opacity - Opacity value (0-1)
 */
function setMaterialOpacity(material, opacity) {
    if (!material) return;
    
    if (opacity < 1) {
        material.alpha = opacity;
        material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        material.needDepthPrePass = true;
    } else {
        material.alpha = 1;
        material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
        material.needDepthPrePass = false;
    }
}

/**
 * Set opacity for E Shield
 * @param {number} opacity - Opacity value (0-100)
 */
function setEShieldOpacity(opacity) {
    const alpha = opacity / 100;
    if (materials.eShield) {
        setMaterialOpacity(materials.eShield.shell, alpha);
        setMaterialOpacity(materials.eShield.fill, alpha);
    }
}

/**
 * Set opacity for OR Shield
 * @param {number} opacity - Opacity value (0-100)
 */
function setORShieldOpacity(opacity) {
    const alpha = opacity / 100;
    if (materials.orShield) {
        setMaterialOpacity(materials.orShield.shell, alpha);
        setMaterialOpacity(materials.orShield.fill, alpha);
    }
}

/**
 * Set opacity for Graphite Blocks
 * @param {number} opacity - Opacity value (0-100)
 */
function setGraphiteOpacity(opacity) {
    const alpha = opacity / 100;
    if (materials.activeZone && materials.activeZone.graphite) {
        setMaterialOpacity(materials.activeZone.graphite, alpha);
    }
}

/**
 * Set opacity for Channel Tracts
 * @param {number} opacity - Opacity value (0-100)
 */
function setTractsOpacity(opacity) {
    const alpha = opacity / 100;
    if (materials.channelTracts) {
        setMaterialOpacity(materials.channelTracts.steel, alpha);
        setMaterialOpacity(materials.channelTracts.zirconium, alpha);
    }
}

/**
 * Set opacity for Support Cross
 * @param {number} opacity - Opacity value (0-100)
 */
function setSupportCrossOpacity(opacity) {
    const alpha = opacity / 100;
    if (materials.supportCross) {
        setMaterialOpacity(materials.supportCross, alpha);
    }
}

/**
 * Set opacity for KZH Cooling Jacket
 * @param {number} opacity - Opacity value (0-100)
 */
function setKZHCoolingOpacity(opacity) {
    const alpha = opacity / 100;
    if (materials.kzhCooling) {
        setMaterialOpacity(materials.kzhCooling.shell, alpha);
        setMaterialOpacity(materials.kzhCooling.water, alpha * 0.5);  // Water is semi-transparent
    }
}

/**
 * Set opacity for L Shell (Reactor Vessel)
 * @param {number} opacity - Opacity value (0-100)
 */
function setLShellOpacity(opacity) {
    const alpha = opacity / 100;
    if (materials.lShell) {
        setMaterialOpacity(materials.lShell.shell, alpha);
        setMaterialOpacity(materials.lShell.gas, alpha * 0.2);  // Gas gap is very transparent
    }
}

// Event listeners
document.getElementById('rodPosition').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('rodPositionValue').textContent = value + '%';
    ActiveZone.setRodPositions(meshes.controlRods, value);
});

exportBtn.addEventListener('click', exportModel);

document.getElementById('resetView').addEventListener('click', resetCameraView);

// Opacity control event listeners
document.getElementById('eShieldOpacity').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('eShieldOpacityValue').textContent = value + '%';
    setEShieldOpacity(value);
});

document.getElementById('orShieldOpacity').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('orShieldOpacityValue').textContent = value + '%';
    setORShieldOpacity(value);
});

document.getElementById('graphiteOpacity').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('graphiteOpacityValue').textContent = value + '%';
    setGraphiteOpacity(value);
});

document.getElementById('tractsOpacity').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('tractsOpacityValue').textContent = value + '%';
    setTractsOpacity(value);
});

document.getElementById('supportCrossOpacity').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('supportCrossOpacityValue').textContent = value + '%';
    setSupportCrossOpacity(value);
});

// KZH Cooling Jacket opacity control (optional - only if element exists)
const kzhOpacityEl = document.getElementById('kzhCoolingOpacity');
if (kzhOpacityEl) {
    kzhOpacityEl.addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('kzhCoolingOpacityValue').textContent = value + '%';
        setKZHCoolingOpacity(value);
    });
}

// L Shell opacity control (optional - only if element exists)
const lShellOpacityEl = document.getElementById('lShellOpacity');
if (lShellOpacityEl) {
    lShellOpacityEl.addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('lShellOpacityValue').textContent = value + '%';
        setLShellOpacity(value);
    });
}

// Initialize on page load
async function init() {
    await initEngine();
    await initReactor();
}

init();
