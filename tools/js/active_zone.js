/**
 * RBMK-1000 Active Zone (Core) Module
 * Creates the graphite moderator blocks with channels
 * 
 * OPTIMIZED VERSION using Thin Instances for massive performance improvement
 * - All graphite blocks rendered in 1-2 draw calls
 * - All gas gaps rendered in 1 draw call
 * 
 * Based on OPB-82 second generation reactor specification
 */

// Constants - RBMK-1000 dimensions
const RBMK = {
    SCALE: 0.01,
    CORE_HEIGHT: 700,
    GRID_SPACING: 25,
    GRID_SIZE: 48,
    CHANNEL_DIAMETER: 11.4,
    BLOCK_GAP: 1.5,
    BLOCK_HEIGHT: 70,
    VERTICAL_GAP: 1.0,
    FUEL_ASSEMBLY_DIAMETER: 4.5,
    ROD_DIAMETER: 4.0,
    ABSORBER_LENGTH_NORMAL: 700,
    DISPLACER_LENGTH_NORMAL: 500,
    ABSORBER_LENGTH_USP: 350,
};

const CHANNEL_COLORS = {
    TK: { r: 0.8, g: 0.4, b: 0.1 },
    RR: { r: 1.0, g: 1.0, b: 1.0 },
    AR: { r: 0.0, g: 0.69, b: 0.57 },
    USP: { r: 1.0, g: 0.85, b: 0.0 },
    LAR: { r: 0.0, g: 0.4, b: 0.81 },
    AZ: { r: 0.87, g: 0.1, b: 0.01 },
    GRAPHITE: { r: 0.25, g: 0.25, b: 0.28 },
};

function createActiveZoneMaterials(scene) {
    const materials = {};
    
    materials.graphite = new BABYLON.StandardMaterial('graphiteMat', scene);
    materials.graphite.diffuseColor = new BABYLON.Color3(
        CHANNEL_COLORS.GRAPHITE.r, CHANNEL_COLORS.GRAPHITE.g, CHANNEL_COLORS.GRAPHITE.b
    );
    materials.graphite.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    
    materials.heN2Gas = new BABYLON.StandardMaterial('heN2GasMat', scene);
    materials.heN2Gas.diffuseColor = new BABYLON.Color3(0.6, 0.8, 0.9);
    materials.heN2Gas.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    materials.heN2Gas.emissiveColor = new BABYLON.Color3(0.05, 0.1, 0.12);
    materials.heN2Gas.alpha = 0.25;
    materials.heN2Gas.backFaceCulling = false;
    
    materials.fuel = new BABYLON.StandardMaterial('fuelMat', scene);
    materials.fuel.diffuseColor = new BABYLON.Color3(
        CHANNEL_COLORS.TK.r, CHANNEL_COLORS.TK.g, CHANNEL_COLORS.TK.b
    );
    materials.fuel.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    materials.fuel.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0);
    
    for (const [type, color] of Object.entries(CHANNEL_COLORS)) {
        if (type === 'TK' || type === 'GRAPHITE') continue;
        materials[type] = new BABYLON.StandardMaterial(`mat_${type}`, scene);
        materials[type].diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        materials[type].specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
        materials[type].emissiveColor = new BABYLON.Color3(color.r * 0.15, color.g * 0.15, color.b * 0.15);
    }
    
    return materials;
}

async function loadCoreLayout(jsonPath = 'ref.json') {
    const response = await fetch(jsonPath);
    if (!response.ok) throw new Error('Failed to load ' + jsonPath);
    const data = await response.json();
    
    const positionSets = { az: new Set(), ar: new Set(), lar: new Set(), usp: new Set(), rr: new Set(), tk: new Set(), all: new Set() };
    
    for (const cell of data.cells.AZ) { const key = `${cell.grid_x},${cell.grid_y}`; positionSets.az.add(key); positionSets.all.add(key); }
    for (const cell of data.cells.AR) { const key = `${cell.grid_x},${cell.grid_y}`; positionSets.ar.add(key); positionSets.all.add(key); }
    for (const cell of data.cells.LAR) { const key = `${cell.grid_x},${cell.grid_y}`; positionSets.lar.add(key); positionSets.all.add(key); }
    for (const cell of data.cells.USP) { const key = `${cell.grid_x},${cell.grid_y}`; positionSets.usp.add(key); positionSets.all.add(key); }
    for (const cell of data.cells.RR) { const key = `${cell.grid_x},${cell.grid_y}`; positionSets.rr.add(key); positionSets.all.add(key); }
    for (const cell of data.cells.TK) { const key = `${cell.grid_x},${cell.grid_y}`; positionSets.tk.add(key); positionSets.all.add(key); }
    
    const coreLayout = [];
    let channelId = 0;
    
    for (let gx = 0; gx < RBMK.GRID_SIZE; gx++) {
        for (let gy = 0; gy < RBMK.GRID_SIZE; gy++) {
            const key = `${gx},${gy}`;
            if (!positionSets.all.has(key)) continue;
            
            const cx = (gx - RBMK.GRID_SIZE / 2 + 0.5) * RBMK.GRID_SPACING;
            const cy = (gy - RBMK.GRID_SIZE / 2 + 0.5) * RBMK.GRID_SPACING;
            
            let type;
            if (positionSets.az.has(key)) type = 'AZ';
            else if (positionSets.ar.has(key)) type = 'AR';
            else if (positionSets.lar.has(key)) type = 'LAR';
            else if (positionSets.usp.has(key)) type = 'USP';
            else if (positionSets.rr.has(key)) type = 'RR';
            else type = 'TK';
            
            coreLayout.push({ id: channelId++, type, gridX: gx, gridY: gy, x: cx, y: cy });
        }
    }
    
    return coreLayout;
}

function createGraphiteBlockWithHole(name, blockSize, holeRadius, height, material, scene) {
    const box = BABYLON.MeshBuilder.CreateBox(name + '_box', { width: blockSize, height: height, depth: blockSize }, scene);
    const hole = BABYLON.MeshBuilder.CreateCylinder(name + '_hole', { diameter: holeRadius * 2, height: height + 0.1, tessellation: 16 }, scene);
    
    const boxCSG = BABYLON.CSG.FromMesh(box);
    const holeCSG = BABYLON.CSG.FromMesh(hole);
    const resultCSG = boxCSG.subtract(holeCSG);
    const result = resultCSG.toMesh(name, material, scene);
    
    box.dispose();
    hole.dispose();
    
    return result;
}

async function createActiveZone(scene, coreLayout, materials, onProgress = null) {
    const meshes = { graphiteBlocks: [], gasGaps: [], fuelChannels: [], controlRods: [], rodDisplacers: [] };
    
    const coreHeight = RBMK.CORE_HEIGHT * RBMK.SCALE;
    const gridSpacing = RBMK.GRID_SPACING * RBMK.SCALE;
    const blockGap = RBMK.BLOCK_GAP * RBMK.SCALE;
    const blockHeight = RBMK.BLOCK_HEIGHT * RBMK.SCALE;
    const verticalGap = RBMK.VERTICAL_GAP * RBMK.SCALE;
    const actualBlockSize = gridSpacing - blockGap;
    const channelRadius = (RBMK.CHANNEL_DIAMETER / 2) * RBMK.SCALE;
    const fuelRadius = (RBMK.FUEL_ASSEMBLY_DIAMETER / 2) * RBMK.SCALE;
    const rodRadius = (RBMK.ROD_DIAMETER / 2) * RBMK.SCALE;
    const halfBlockHeight = blockHeight / 2;
    
    // Collect matrices
    const fullBlockMatrices = [];
    const halfBlockMatrices = [];
    const partialTopBlocks = [];
    const hGapMatrices = [];
    const vGapMatrices = [];
    const cornerGapMatrices = [];
    const layerGapMatrices = [];
    
    const occupiedPositions = new Set();
    for (const channel of coreLayout) occupiedPositions.add(`${channel.gridX},${channel.gridY}`);
    
    const createdHGaps = new Set();
    const createdVGaps = new Set();
    const createdCornerGaps = new Set();
    
    // Phase 1: Collect all transformation matrices
    for (const channel of coreLayout) {
        const x = channel.x * RBMK.SCALE;
        const z = channel.y * RBMK.SCALE;
        const isStaggered = (channel.gridX + channel.gridY) % 2 === 1;
        
        let currentY = 0;
        
        if (isStaggered) {
            halfBlockMatrices.push(BABYLON.Matrix.Translation(x, halfBlockHeight / 2, z));
            currentY = halfBlockHeight;
            if (verticalGap > 0) {
                layerGapMatrices.push(BABYLON.Matrix.Translation(x, currentY + verticalGap / 2, z));
                currentY += verticalGap;
            }
        }
        
        while (currentY + blockHeight <= coreHeight) {
            fullBlockMatrices.push(BABYLON.Matrix.Translation(x, currentY + blockHeight / 2, z));
            currentY += blockHeight;
            if (currentY < coreHeight && verticalGap > 0) {
                layerGapMatrices.push(BABYLON.Matrix.Translation(x, currentY + verticalGap / 2, z));
                currentY += verticalGap;
            }
        }
        
        const remainingSpace = coreHeight - currentY;
        if (remainingSpace > 0.001) {
            partialTopBlocks.push({ x, y: currentY + remainingSpace / 2, z, height: remainingSpace });
        }
        
        const rightKey = `${channel.gridX + 1},${channel.gridY}`;
        const hGapKey = `${channel.gridX},${channel.gridY}_h`;
        if (occupiedPositions.has(rightKey) && !createdHGaps.has(hGapKey)) {
            hGapMatrices.push(BABYLON.Matrix.Translation(x + gridSpacing / 2, coreHeight / 2, z));
            createdHGaps.add(hGapKey);
        }
        
        const bottomKey = `${channel.gridX},${channel.gridY + 1}`;
        const vGapKey = `${channel.gridX},${channel.gridY}_v`;
        if (occupiedPositions.has(bottomKey) && !createdVGaps.has(vGapKey)) {
            vGapMatrices.push(BABYLON.Matrix.Translation(x, coreHeight / 2, z + gridSpacing / 2));
            createdVGaps.add(vGapKey);
        }
        
        const diagKey = `${channel.gridX + 1},${channel.gridY + 1}`;
        const cornerGapKey = `${channel.gridX},${channel.gridY}_c`;
        if (occupiedPositions.has(rightKey) && occupiedPositions.has(bottomKey) && occupiedPositions.has(diagKey) && !createdCornerGaps.has(cornerGapKey)) {
            cornerGapMatrices.push(BABYLON.Matrix.Translation(x + gridSpacing / 2, coreHeight / 2, z + gridSpacing / 2));
            createdCornerGaps.add(cornerGapKey);
        }
    }
    
    if (onProgress) onProgress(30);
    
    // Phase 2: Create graphite blocks with thin instances
    const fullBlockTemplate = createGraphiteBlockWithHole('graphiteFullTemplate', actualBlockSize, channelRadius, blockHeight, materials.graphite, scene);
    if (fullBlockMatrices.length > 0) {
        const buffer = new Float32Array(fullBlockMatrices.length * 16);
        for (let i = 0; i < fullBlockMatrices.length; i++) fullBlockMatrices[i].copyToArray(buffer, i * 16);
        fullBlockTemplate.thinInstanceSetBuffer("matrix", buffer, 16);
    }
    meshes.graphiteBlocks.push(fullBlockTemplate);
    
    if (halfBlockMatrices.length > 0) {
        const halfBlockTemplate = createGraphiteBlockWithHole('graphiteHalfTemplate', actualBlockSize, channelRadius, halfBlockHeight, materials.graphite, scene);
        const buffer = new Float32Array(halfBlockMatrices.length * 16);
        for (let i = 0; i < halfBlockMatrices.length; i++) halfBlockMatrices[i].copyToArray(buffer, i * 16);
        halfBlockTemplate.thinInstanceSetBuffer("matrix", buffer, 16);
        meshes.graphiteBlocks.push(halfBlockTemplate);
    }
    
    if (onProgress) onProgress(50);
    
    // Partial top blocks grouped by height
    const heightGroups = new Map();
    for (const block of partialTopBlocks) {
        const roundedHeight = Math.round(block.height * 1000) / 1000;
        if (!heightGroups.has(roundedHeight)) heightGroups.set(roundedHeight, []);
        heightGroups.get(roundedHeight).push(block);
    }
    
    for (const [height, blocks] of heightGroups) {
        const template = createGraphiteBlockWithHole(`graphitePartial_${height.toFixed(3)}`, actualBlockSize, channelRadius, height, materials.graphite, scene);
        const matrices = blocks.map(b => BABYLON.Matrix.Translation(b.x, b.y, b.z));
        const buffer = new Float32Array(matrices.length * 16);
        for (let i = 0; i < matrices.length; i++) matrices[i].copyToArray(buffer, i * 16);
        template.thinInstanceSetBuffer("matrix", buffer, 16);
        meshes.graphiteBlocks.push(template);
    }
    
    if (onProgress) onProgress(60);
    
    // Phase 3: Gas gaps with thin instances
    if (hGapMatrices.length > 0) {
        const hGapTemplate = BABYLON.MeshBuilder.CreateBox('gasGapHTemplate', { width: blockGap, height: coreHeight, depth: actualBlockSize }, scene);
        hGapTemplate.material = materials.heN2Gas;
        const buffer = new Float32Array(hGapMatrices.length * 16);
        for (let i = 0; i < hGapMatrices.length; i++) hGapMatrices[i].copyToArray(buffer, i * 16);
        hGapTemplate.thinInstanceSetBuffer("matrix", buffer, 16);
        meshes.gasGaps.push(hGapTemplate);
    }
    
    if (vGapMatrices.length > 0) {
        const vGapTemplate = BABYLON.MeshBuilder.CreateBox('gasGapVTemplate', { width: actualBlockSize, height: coreHeight, depth: blockGap }, scene);
        vGapTemplate.material = materials.heN2Gas;
        const buffer = new Float32Array(vGapMatrices.length * 16);
        for (let i = 0; i < vGapMatrices.length; i++) vGapMatrices[i].copyToArray(buffer, i * 16);
        vGapTemplate.thinInstanceSetBuffer("matrix", buffer, 16);
        meshes.gasGaps.push(vGapTemplate);
    }
    
    if (cornerGapMatrices.length > 0) {
        const cornerGapTemplate = BABYLON.MeshBuilder.CreateBox('gasGapCornerTemplate', { width: blockGap, height: coreHeight, depth: blockGap }, scene);
        cornerGapTemplate.material = materials.heN2Gas;
        const buffer = new Float32Array(cornerGapMatrices.length * 16);
        for (let i = 0; i < cornerGapMatrices.length; i++) cornerGapMatrices[i].copyToArray(buffer, i * 16);
        cornerGapTemplate.thinInstanceSetBuffer("matrix", buffer, 16);
        meshes.gasGaps.push(cornerGapTemplate);
    }
    
    if (layerGapMatrices.length > 0) {
        const layerGapTemplate = BABYLON.MeshBuilder.CreateBox('gasGapLayerTemplate', { width: actualBlockSize, height: verticalGap, depth: actualBlockSize }, scene);
        layerGapTemplate.material = materials.heN2Gas;
        const buffer = new Float32Array(layerGapMatrices.length * 16);
        for (let i = 0; i < layerGapMatrices.length; i++) layerGapMatrices[i].copyToArray(buffer, i * 16);
        layerGapTemplate.thinInstanceSetBuffer("matrix", buffer, 16);
        meshes.gasGaps.push(layerGapTemplate);
    }
    
    if (onProgress) onProgress(70);
    
    // Phase 4: Fuel channels with thin instances
    const fuelMatrices = [];
    const controlRodData = [];
    
    for (const channel of coreLayout) {
        const x = channel.x * RBMK.SCALE;
        const z = channel.y * RBMK.SCALE;
        if (channel.type === 'TK') {
            fuelMatrices.push(BABYLON.Matrix.Translation(x, coreHeight / 2, z));
        } else {
            controlRodData.push({ type: channel.type, x, z, id: channel.id });
        }
    }
    
    if (fuelMatrices.length > 0) {
        const fuelTemplate = BABYLON.MeshBuilder.CreateCylinder('fuelTemplate', { diameter: fuelRadius * 2, height: coreHeight * 1.02, tessellation: 12 }, scene);
        fuelTemplate.material = materials.fuel;
        const buffer = new Float32Array(fuelMatrices.length * 16);
        for (let i = 0; i < fuelMatrices.length; i++) fuelMatrices[i].copyToArray(buffer, i * 16);
        fuelTemplate.thinInstanceSetBuffer("matrix", buffer, 16);
        meshes.fuelChannels.push(fuelTemplate);
    }
    
    if (onProgress) onProgress(80);
    
    // Control rods (individual meshes for animation)
    for (const rod of controlRodData) {
        const isUSP = rod.type === 'USP';
        
        if (isUSP) {
            const absorberLength = RBMK.ABSORBER_LENGTH_USP * RBMK.SCALE;
            const absorber = BABYLON.MeshBuilder.CreateCylinder(`absorber_${rod.id}`, { diameter: rodRadius * 2, height: absorberLength, tessellation: 12 }, scene);
            absorber.material = materials[rod.type];
            absorber.metadata = { type: rod.type, part: 'absorber', isUSP: true, absorberLength, displacer: null, displacerLength: 0, baseX: rod.x, baseZ: rod.z };
            absorber.position.set(rod.x, absorberLength / 2, rod.z);
            meshes.controlRods.push(absorber);
        } else {
            const displacerLength = RBMK.DISPLACER_LENGTH_NORMAL * RBMK.SCALE;
            const absorberLength = RBMK.ABSORBER_LENGTH_NORMAL * RBMK.SCALE;
            
            const absorber = BABYLON.MeshBuilder.CreateCylinder(`absorber_${rod.id}`, { diameter: rodRadius * 2, height: absorberLength, tessellation: 12 }, scene);
            absorber.material = materials[rod.type];
            absorber.metadata = { type: rod.type, part: 'absorber' };
            meshes.controlRods.push(absorber);
            
            const displacer = BABYLON.MeshBuilder.CreateCylinder(`displacer_${rod.id}`, { diameter: rodRadius * 2, height: displacerLength, tessellation: 12 }, scene);
            displacer.material = materials.graphite;
            displacer.metadata = { type: rod.type, part: 'displacer' };
            meshes.rodDisplacers.push(displacer);
            
            absorber.position.set(rod.x, coreHeight / 2, rod.z);
            displacer.position.set(rod.x, -displacerLength / 2, rod.z);
            
            absorber.metadata.displacer = displacer;
            absorber.metadata.absorberLength = absorberLength;
            absorber.metadata.displacerLength = displacerLength;
            absorber.metadata.isUSP = false;
            absorber.metadata.baseX = rod.x;
            absorber.metadata.baseZ = rod.z;
        }
    }
    
    if (onProgress) onProgress(100);
    
    const totalGraphiteInstances = fullBlockMatrices.length + halfBlockMatrices.length + partialTopBlocks.length;
    const totalGasGapInstances = hGapMatrices.length + vGapMatrices.length + cornerGapMatrices.length + layerGapMatrices.length;
    
    console.log(`Active Zone created with THIN INSTANCES optimization:`);
    console.log(`  - ${totalGraphiteInstances} graphite block instances (${meshes.graphiteBlocks.length} draw calls)`);
    console.log(`  - ${totalGasGapInstances} gas gap instances (${meshes.gasGaps.length} draw calls)`);
    console.log(`  - ${fuelMatrices.length} fuel channel instances (1 draw call)`);
    console.log(`  - ${meshes.controlRods.length} control rods, ${meshes.rodDisplacers.length} displacers`);
    
    return meshes;
}

function setRodPositions(controlRods, position) {
    const coreHeight = RBMK.CORE_HEIGHT * RBMK.SCALE;
    const positionFraction = position / 100;
    
    for (const absorber of controlRods) {
        const meta = absorber.metadata;
        if (!meta) continue;
        
        const displacer = meta.displacer;
        const absorberLength = meta.absorberLength;
        const displacerLength = meta.displacerLength || 0;
        const x = meta.baseX;
        const z = meta.baseZ;
        
        if (meta.isUSP) {
            const withdrawnAmount = positionFraction * absorberLength;
            absorber.position.set(x, absorberLength / 2 - withdrawnAmount, z);
        } else {
            const withdrawnAmount = positionFraction * coreHeight;
            absorber.position.set(x, coreHeight / 2 + withdrawnAmount, z);
            if (displacer) displacer.position.set(x, -displacerLength / 2 + withdrawnAmount, z);
        }
    }
}

function getActiveZoneStats(coreLayout) {
    const stats = { totalChannels: coreLayout.length, fuelChannels: 0, controlRods: { total: 0, RR: 0, AR: 0, LAR: 0, USP: 0, AZ: 0 } };
    for (const channel of coreLayout) {
        if (channel.type === 'TK') stats.fuelChannels++;
        else { stats.controlRods.total++; stats.controlRods[channel.type]++; }
    }
    return stats;
}

window.ActiveZone = {
    RBMK,
    CHANNEL_COLORS,
    createMaterials: createActiveZoneMaterials,
    loadLayout: loadCoreLayout,
    create: createActiveZone,
    setRodPositions,
    getStats: getActiveZoneStats
};
