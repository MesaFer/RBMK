/**
 * RBMK-1000 KZH Cooling Jacket Module (Схема "КЖ")
 * Creates the cooling water jacket between graphite stack and reactor shell
 * 
 * Схема "КЖ" (Контур охлаждения кожуха) - система водяного охлаждения,
 * расположенная между графитовой кладкой и корпусом реактора (Схемой "Л").
 * 
 * ГИБРИДНАЯ ВЕРСИЯ: 
 * - Внешняя оболочка - идеальный круг (для стыковки с корпусом "Л")
 * - Внутренняя оболочка - повторяет контур графитовой кладки
 * - Вода заполняет пространство между ними
 * 
 * Конструкция:
 * - Внешняя цилиндрическая оболочка (круглая)
 * - Внутренняя оболочка, следующая контуру кладки
 * - Пространство между ними заполнено водой
 * - Функции: охлаждение боковой поверхности графитовой кладки + биологическая защита
 * 
 * Dimensions:
 * - Outer diameter: ~13 m (circular)
 * - Inner: follows graphite contour with ~0.2 cm gap
 * - Water layer thickness: variable (fills the gap)
 * - Height: ~7 m (active zone height)
 */

// KZH Cooling Jacket dimensions based on RBMK specifications
const KZH_COOLING = {
    // Dimensions in cm
    OUTER_DIAMETER: 1300,       // cm - 13 m outer diameter (circular)
    GAP_FROM_GRAPHITE: -0.25,     // cm - minimal gap between graphite edge and inner shell
    HEIGHT: 700,                // cm - 7 m (matches active zone height)
    
    // Shell wall thickness
    INNER_WALL_THICKNESS: 1.0,  // cm - inner shell wall
    OUTER_WALL_THICKNESS: 1.0,  // cm - outer shell wall
    
    // Position - aligned with active zone (bottom at Y=0)
    POSITION_Y: 350,            // cm - center of cooling jacket (bottom at 0, top at 700)
    
    // Grid parameters (from RBMK)
    GRID_SPACING: 25,           // cm
    GRID_SIZE: 48,
};

// Material colors
const KZH_SHELL_COLOR = { r: 0.5, g: 0.5, b: 0.55 };     // Steel shell (gray)
const KZH_WATER_COLOR = { r: 0.2, g: 0.5, b: 0.8 };      // Water (blue)

/**
 * Create materials for the KZH cooling jacket
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {Object} Materials object
 */
function createKZHCoolingMaterials(scene) {
    const materials = {};
    
    // Steel shell material (inner and outer shells)
    materials.shell = new BABYLON.StandardMaterial('kzhShellMat', scene);
    materials.shell.diffuseColor = new BABYLON.Color3(KZH_SHELL_COLOR.r, KZH_SHELL_COLOR.g, KZH_SHELL_COLOR.b);
    materials.shell.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    
    // Water material (semi-transparent blue)
    materials.water = new BABYLON.StandardMaterial('kzhWaterMat', scene);
    materials.water.diffuseColor = new BABYLON.Color3(KZH_WATER_COLOR.r, KZH_WATER_COLOR.g, KZH_WATER_COLOR.b);
    materials.water.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    materials.water.alpha = 0.5;
    materials.water.backFaceCulling = false;
    
    return materials;
}

/**
 * Create a single material for simplified version
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {BABYLON.StandardMaterial} Cooling jacket material
 */
function createKZHCoolingMaterial(scene) {
    const material = new BABYLON.StandardMaterial('kzhCoolingMat', scene);
    material.diffuseColor = new BABYLON.Color3(KZH_WATER_COLOR.r, KZH_WATER_COLOR.g, KZH_WATER_COLOR.b);
    material.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    material.alpha = 0.6;
    material.backFaceCulling = false;
    return material;
}

/**
 * Create inner shell segments that follow the graphite contour
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {Array} coreLayout - Core layout array
 * @param {number} offset - Offset from graphite edge in cm
 * @param {number} thickness - Wall thickness in cm
 * @param {number} height - Wall height
 * @param {BABYLON.Material} material - Material for the walls
 * @param {number} scale - Scale factor
 * @param {string} namePrefix - Name prefix for meshes
 * @returns {Array} Array of wall meshes
 */
function createInnerContourWalls(scene, coreLayout, offset, thickness, height, material, scale, namePrefix) {
    const gridSpacing = KZH_COOLING.GRID_SPACING;
    const gridSize = KZH_COOLING.GRID_SIZE;
    const halfBlock = gridSpacing / 2;
    const positionY = KZH_COOLING.POSITION_Y * scale;
    
    const meshes = [];
    
    // Create a grid map
    const occupiedPositions = new Set();
    for (const channel of coreLayout) {
        occupiedPositions.add(`${channel.gridX},${channel.gridY}`);
    }
    
    // Find boundary cells and their edges
    const edgeSegments = [];
    
    for (const channel of coreLayout) {
        const gx = channel.gridX;
        const gy = channel.gridY;
        
        const worldX = (gx - gridSize / 2 + 0.5) * gridSpacing;
        const worldZ = (gy - gridSize / 2 + 0.5) * gridSpacing;
        
        // Check each direction for boundary
        // Left edge
        if (!occupiedPositions.has(`${gx-1},${gy}`)) {
            edgeSegments.push({
                type: 'vertical',
                x: worldX - halfBlock - offset - thickness/2,
                z: worldZ,
                length: gridSpacing
            });
        }
        // Right edge
        if (!occupiedPositions.has(`${gx+1},${gy}`)) {
            edgeSegments.push({
                type: 'vertical',
                x: worldX + halfBlock + offset + thickness/2,
                z: worldZ,
                length: gridSpacing
            });
        }
        // Top edge
        if (!occupiedPositions.has(`${gx},${gy-1}`)) {
            edgeSegments.push({
                type: 'horizontal',
                x: worldX,
                z: worldZ - halfBlock - offset - thickness/2,
                length: gridSpacing
            });
        }
        // Bottom edge
        if (!occupiedPositions.has(`${gx},${gy+1}`)) {
            edgeSegments.push({
                type: 'horizontal',
                x: worldX,
                z: worldZ + halfBlock + offset + thickness/2,
                length: gridSpacing
            });
        }
    }
    
    // Merge adjacent segments of the same type
    const mergedSegments = mergeEdgeSegments(edgeSegments);
    
    // Create meshes for each segment
    for (let i = 0; i < mergedSegments.length; i++) {
        const seg = mergedSegments[i];
        let wall;
        
        if (seg.type === 'vertical') {
            wall = BABYLON.MeshBuilder.CreateBox(`${namePrefix}_v_${i}`, {
                width: thickness * scale,
                height: height,
                depth: seg.length * scale
            }, scene);
            wall.position.set(seg.x * scale, positionY, seg.z * scale);
        } else {
            wall = BABYLON.MeshBuilder.CreateBox(`${namePrefix}_h_${i}`, {
                width: seg.length * scale,
                height: height,
                depth: thickness * scale
            }, scene);
            wall.position.set(seg.x * scale, positionY, seg.z * scale);
        }
        
        wall.material = material;
        meshes.push(wall);
    }
    
    return meshes;
}

/**
 * Merge adjacent edge segments
 */
function mergeEdgeSegments(segments) {
    // Group by type and position
    const verticalByX = new Map();
    const horizontalByZ = new Map();
    
    for (const seg of segments) {
        if (seg.type === 'vertical') {
            const key = seg.x.toFixed(2);
            if (!verticalByX.has(key)) verticalByX.set(key, []);
            verticalByX.get(key).push(seg);
        } else {
            const key = seg.z.toFixed(2);
            if (!horizontalByZ.has(key)) horizontalByZ.set(key, []);
            horizontalByZ.get(key).push(seg);
        }
    }
    
    const merged = [];
    
    // Merge vertical segments
    for (const [x, segs] of verticalByX) {
        segs.sort((a, b) => a.z - b.z);
        let current = { ...segs[0] };
        
        for (let i = 1; i < segs.length; i++) {
            const next = segs[i];
            const gap = next.z - current.length/2 - (current.z + current.length/2);
            
            if (Math.abs(gap) < 1) {
                // Merge
                const newZ = (current.z + next.z) / 2;
                const newLength = (next.z + next.length/2) - (current.z - current.length/2);
                current.z = newZ;
                current.length = newLength;
            } else {
                merged.push(current);
                current = { ...next };
            }
        }
        merged.push(current);
    }
    
    // Merge horizontal segments
    for (const [z, segs] of horizontalByZ) {
        segs.sort((a, b) => a.x - b.x);
        let current = { ...segs[0] };
        
        for (let i = 1; i < segs.length; i++) {
            const next = segs[i];
            const gap = next.x - current.length/2 - (current.x + current.length/2);
            
            if (Math.abs(gap) < 1) {
                // Merge
                const newX = (current.x + next.x) / 2;
                const newLength = (next.x + next.length/2) - (current.x - current.length/2);
                current.x = newX;
                current.length = newLength;
            } else {
                merged.push(current);
                current = { ...next };
            }
        }
        merged.push(current);
    }
    
    return merged;
}

/**
 * Create the KZH cooling jacket (Схема "КЖ") - hybrid version
 * Outer shell is circular, inner shell follows graphite contour
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {Object} materials - Materials object (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @param {Function} onProgress - Progress callback (optional)
 * @param {Array} coreLayout - Core layout array (optional)
 * @returns {Promise<Object>} Object containing cooling jacket meshes
 */
async function createKZHCooling(scene, materials = null, scale = 0.01, onProgress = null, coreLayout = null) {
    if (!materials || !materials.shell) {
        materials = createKZHCoolingMaterials(scene);
    }
    
    const meshes = {
        outerShell: null,
        innerShell: [],
        water: null,
        all: []
    };
    
    const outerDiameter = KZH_COOLING.OUTER_DIAMETER * scale;
    const height = KZH_COOLING.HEIGHT * scale;
    const positionY = KZH_COOLING.POSITION_Y * scale;
    const outerWallThickness = KZH_COOLING.OUTER_WALL_THICKNESS * scale;
    const innerWallThickness = KZH_COOLING.INNER_WALL_THICKNESS;
    const gapFromGraphite = KZH_COOLING.GAP_FROM_GRAPHITE;
    
    console.log(`Creating KZH Cooling Jacket (Схема "КЖ") - Hybrid version`);
    console.log(`  Outer: circular Ø=${KZH_COOLING.OUTER_DIAMETER}cm`);
    console.log(`  Inner: follows graphite contour with ${gapFromGraphite}cm gap`);
    
    // =====================
    // 1. Create OUTER circular shell
    // =====================
    const outerRadius = outerDiameter / 2;
    const outerShellInnerR = outerRadius - outerWallThickness;
    
    const outerCylOuter = BABYLON.MeshBuilder.CreateCylinder('kzhOuterCylOuter', {
        diameter: outerDiameter,
        height: height,
        tessellation: 64
    }, scene);
    
    const outerCylInner = BABYLON.MeshBuilder.CreateCylinder('kzhOuterCylInner', {
        diameter: outerShellInnerR * 2,
        height: height + 0.1,
        tessellation: 64
    }, scene);
    
    const outerCSG = BABYLON.CSG.FromMesh(outerCylOuter);
    const outerInnerCSG = BABYLON.CSG.FromMesh(outerCylInner);
    const outerShellCSG = outerCSG.subtract(outerInnerCSG);
    
    const outerShell = outerShellCSG.toMesh('kzhOuterShell', materials.shell, scene);
    outerShell.position.y = positionY;
    meshes.outerShell = outerShell;
    meshes.all.push(outerShell);
    
    outerCylOuter.dispose();
    outerCylInner.dispose();
    
    if (onProgress) onProgress(25);
    
    // =====================
    // 2. Create WATER layer (circular outer, follows graphite inner)
    // =====================
    // Start with a solid cylinder
    const waterCyl = BABYLON.MeshBuilder.CreateCylinder('kzhWaterCyl', {
        diameter: outerShellInnerR * 2 - 0.01,
        height: height - 0.02,
        tessellation: 64
    }, scene);
    
    // If we have coreLayout, subtract the graphite area
    if (coreLayout && coreLayout.length > 0) {
        // Create a box for each graphite block position (with gap)
        const gridSpacing = KZH_COOLING.GRID_SPACING * scale;
        const gridSize = KZH_COOLING.GRID_SIZE;
        const halfBlock = gridSpacing / 2;
        const gap = gapFromGraphite * scale;
        
        let waterCSG = BABYLON.CSG.FromMesh(waterCyl);
        
        // Create a single large box that covers all graphite blocks
        // Find bounds
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const channel of coreLayout) {
            const worldX = (channel.gridX - gridSize / 2 + 0.5) * KZH_COOLING.GRID_SPACING * scale;
            const worldZ = (channel.gridY - gridSize / 2 + 0.5) * KZH_COOLING.GRID_SPACING * scale;
            minX = Math.min(minX, worldX - halfBlock);
            maxX = Math.max(maxX, worldX + halfBlock);
            minZ = Math.min(minZ, worldZ - halfBlock);
            maxZ = Math.max(maxZ, worldZ + halfBlock);
        }
        
        // Create subtraction boxes for each row
        const occupiedPositions = new Set();
        for (const channel of coreLayout) {
            occupiedPositions.add(`${channel.gridX},${channel.gridY}`);
        }
        
        // Find min/max grid coordinates
        let minGX = Infinity, maxGX = -Infinity;
        let minGY = Infinity, maxGY = -Infinity;
        for (const channel of coreLayout) {
            minGX = Math.min(minGX, channel.gridX);
            maxGX = Math.max(maxGX, channel.gridX);
            minGY = Math.min(minGY, channel.gridY);
            maxGY = Math.max(maxGY, channel.gridY);
        }
        
        // Create subtraction boxes for each row (X direction)
        // Use depth with gap to leave water space between rows
        for (let gy = minGY; gy <= maxGY; gy++) {
            let leftEdge = null;
            let rightEdge = null;
            
            for (let gx = minGX; gx <= maxGX; gx++) {
                if (occupiedPositions.has(`${gx},${gy}`)) {
                    if (leftEdge === null) leftEdge = gx;
                    rightEdge = gx;
                }
            }
            
            if (leftEdge !== null) {
                const worldZ = (gy - gridSize / 2 + 0.5) * KZH_COOLING.GRID_SPACING * scale;
                const leftX = (leftEdge - gridSize / 2  + 0.5) * KZH_COOLING.GRID_SPACING * scale - halfBlock + gap;
                const rightX = (rightEdge - gridSize / 2 + 0.5) * KZH_COOLING.GRID_SPACING * scale + halfBlock - gap;
                const width = rightX - leftX;
                const centerX = (leftX + rightX) / 2;
                
                const subBox = BABYLON.MeshBuilder.CreateBox(`subBoxRow_${gy}`, {
                    width: width,
                    height: height + 0.2,
                    depth: gridSpacing - gap * 2  // Leave gap for water between rows
                }, scene);
                subBox.position.set(centerX, 0, worldZ);
                
                const subCSG = BABYLON.CSG.FromMesh(subBox);
                waterCSG = waterCSG.subtract(subCSG);
                subBox.dispose();
            }
        }
        
        const water = waterCSG.toMesh('kzhWater', materials.water, scene);
        water.position.y = positionY;
        meshes.water = water;
        meshes.all.push(water);
        waterCyl.dispose();
    } else {
        // Fallback: simple circular water layer
        const innerWaterR = (KZH_COOLING.OUTER_DIAMETER - 100) / 2 * scale; // 1m less than outer
        
        const waterInner = BABYLON.MeshBuilder.CreateCylinder('kzhWaterInner', {
            diameter: innerWaterR * 2,
            height: height + 0.1,
            tessellation: 64
        }, scene);
        
        const waterOuterCSG = BABYLON.CSG.FromMesh(waterCyl);
        const waterInnerCSG = BABYLON.CSG.FromMesh(waterInner);
        const waterCSG = waterOuterCSG.subtract(waterInnerCSG);
        
        const water = waterCSG.toMesh('kzhWater', materials.water, scene);
        water.position.y = positionY;
        meshes.water = water;
        meshes.all.push(water);
        
        waterCyl.dispose();
        waterInner.dispose();
    }
    
    if (onProgress) onProgress(75);
    
    // =====================
    // 3. Create INNER shell (follows graphite contour)
    // =====================
    if (coreLayout && coreLayout.length > 0) {
        const innerShellMeshes = createInnerContourWalls(
            scene, coreLayout, 
            gapFromGraphite, 
            innerWallThickness, 
            height, 
            materials.shell, 
            scale, 
            'kzhInnerShell'
        );
        meshes.innerShell = innerShellMeshes;
        meshes.all.push(...innerShellMeshes);
    }
    
    if (onProgress) onProgress(100);
    
    console.log(`KZH Cooling Jacket (Схема "КЖ") created: outer shell + water + ${meshes.innerShell.length} inner shell segments`);
    
    return meshes;
}

/**
 * Get all meshes from the KZH cooling jacket for export
 * @param {Object} coolingMeshes - Meshes object from createKZHCooling()
 * @returns {Array} Array of all meshes
 */
function getKZHCoolingMeshes(coolingMeshes) {
    return coolingMeshes.all || [];
}

// Export functions
window.KZHCooling = {
    DIMENSIONS: KZH_COOLING,
    SHELL_COLOR: KZH_SHELL_COLOR,
    WATER_COLOR: KZH_WATER_COLOR,
    createMaterial: createKZHCoolingMaterial,
    createMaterials: createKZHCoolingMaterials,
    create: createKZHCooling,
    getMeshes: getKZHCoolingMeshes
};
