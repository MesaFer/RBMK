/**
 * RBMK-1000 Support Cross Module (Схема "С")
 * Creates the metallic cross support structure under the reactor
 * 
 * "Металлоконструкция схемы "С" является основной опорной металлоконструкцией 
 * для схемы "ОР". Выполнена в виде креста из двух плит высотой 5,3 метра, 
 * усиленных вертикальными рёбрами жёсткости."
 * 
 * Material: Steel 10ХСНД, metallized with aluminum
 */

// Support cross dimensions based on actual RBMK specifications
const SUPPORT_CROSS = {
    // Main plate dimensions
    PLATE_HEIGHT: 530,      // cm - 5.3 meters height
    PLATE_THICKNESS: 30,    // cm - thickness of each plate
    PLATE_LENGTH: 1450,     // cm - length to match OR shield diameter (14.5m)
    
    // Stiffening ribs
    RIB_HEIGHT: 530,        // cm - same as plate height
    RIB_THICKNESS: 5,       // cm - rib thickness
    RIB_DEPTH: 50,          // cm - how far ribs extend from plate
    RIB_SPACING: 100,       // cm - spacing between ribs
    
    // Position - directly below OR shield (touching it)
    // OR shield: top at 0, bottom at -200cm
    // Support cross top should touch OR shield bottom
    // Cross center = OR bottom - half of cross height = -200 - 265 = -465
    POSITION_Y: -465,       // cm - center position
};

// Material color for steel (10ХСНД with aluminum coating)
const STEEL_COLOR = { r: 0.55, g: 0.55, b: 0.6 };

/**
 * Create material for the support cross
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {BABYLON.StandardMaterial} Steel material
 */
function createSupportCrossMaterial(scene) {
    const material = new BABYLON.StandardMaterial('steelCrossMat', scene);
    material.diffuseColor = new BABYLON.Color3(STEEL_COLOR.r, STEEL_COLOR.g, STEEL_COLOR.b);
    material.specularColor = new BABYLON.Color3(0.7, 0.7, 0.7);
    material.specularPower = 32;
    return material;
}

/**
 * Create the support cross structure (Схема "С")
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {BABYLON.StandardMaterial} material - Steel material (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @returns {Object} Object containing cross meshes
 */
function createSupportCross(scene, material = null, scale = 0.01) {
    if (!material) {
        material = createSupportCrossMaterial(scene);
    }
    
    const meshes = {
        plates: [],
        ribs: [],
        all: []
    };
    
    const plateHeight = SUPPORT_CROSS.PLATE_HEIGHT * scale;
    const plateThickness = SUPPORT_CROSS.PLATE_THICKNESS * scale;
    const plateLength = SUPPORT_CROSS.PLATE_LENGTH * scale;
    const positionY = SUPPORT_CROSS.POSITION_Y * scale;
    
    const ribHeight = SUPPORT_CROSS.RIB_HEIGHT * scale;
    const ribThickness = SUPPORT_CROSS.RIB_THICKNESS * scale;
    const ribDepth = SUPPORT_CROSS.RIB_DEPTH * scale;
    const ribSpacing = SUPPORT_CROSS.RIB_SPACING * scale;
    
    // Create first main plate (along X axis)
    const plate1 = BABYLON.MeshBuilder.CreateBox('crossPlate1', {
        width: plateLength,
        height: plateHeight,
        depth: plateThickness
    }, scene);
    plate1.material = material;
    plate1.position.y = positionY;
    meshes.plates.push(plate1);
    meshes.all.push(plate1);
    
    // Create second main plate (along Z axis, perpendicular)
    const plate2 = BABYLON.MeshBuilder.CreateBox('crossPlate2', {
        width: plateThickness,
        height: plateHeight,
        depth: plateLength
    }, scene);
    plate2.material = material;
    plate2.position.y = positionY;
    meshes.plates.push(plate2);
    meshes.all.push(plate2);
    
    // Add stiffening ribs to plate 1 (along X axis)
    const numRibs1 = Math.floor(plateLength / ribSpacing) - 1;
    for (let i = 0; i < numRibs1; i++) {
        const ribX = -plateLength / 2 + ribSpacing * (i + 1);
        
        // Rib on positive Z side
        const rib1a = BABYLON.MeshBuilder.CreateBox(`rib1a_${i}`, {
            width: ribThickness,
            height: ribHeight,
            depth: ribDepth
        }, scene);
        rib1a.material = material;
        rib1a.position.set(ribX, positionY, plateThickness / 2 + ribDepth / 2);
        meshes.ribs.push(rib1a);
        meshes.all.push(rib1a);
        
        // Rib on negative Z side
        const rib1b = BABYLON.MeshBuilder.CreateBox(`rib1b_${i}`, {
            width: ribThickness,
            height: ribHeight,
            depth: ribDepth
        }, scene);
        rib1b.material = material;
        rib1b.position.set(ribX, positionY, -plateThickness / 2 - ribDepth / 2);
        meshes.ribs.push(rib1b);
        meshes.all.push(rib1b);
    }
    
    // Add stiffening ribs to plate 2 (along Z axis)
    const numRibs2 = Math.floor(plateLength / ribSpacing) - 1;
    for (let i = 0; i < numRibs2; i++) {
        const ribZ = -plateLength / 2 + ribSpacing * (i + 1);
        
        // Skip ribs near the center where plates intersect
        if (Math.abs(ribZ) < plateThickness * 2) continue;
        
        // Rib on positive X side
        const rib2a = BABYLON.MeshBuilder.CreateBox(`rib2a_${i}`, {
            width: ribDepth,
            height: ribHeight,
            depth: ribThickness
        }, scene);
        rib2a.material = material;
        rib2a.position.set(plateThickness / 2 + ribDepth / 2, positionY, ribZ);
        meshes.ribs.push(rib2a);
        meshes.all.push(rib2a);
        
        // Rib on negative X side
        const rib2b = BABYLON.MeshBuilder.CreateBox(`rib2b_${i}`, {
            width: ribDepth,
            height: ribHeight,
            depth: ribThickness
        }, scene);
        rib2b.material = material;
        rib2b.position.set(-plateThickness / 2 - ribDepth / 2, positionY, ribZ);
        meshes.ribs.push(rib2b);
        meshes.all.push(rib2b);
    }
    
    console.log(`Support Cross (Схема "С") created: ${meshes.plates.length} plates, ${meshes.ribs.length} ribs`);
    
    return meshes;
}

/**
 * Get all meshes from the support cross for export
 * @param {Object} crossMeshes - Meshes object from createSupportCross()
 * @returns {Array} Array of all meshes
 */
function getSupportCrossMeshes(crossMeshes) {
    return crossMeshes.all || [];
}

// Export functions
window.SupportCross = {
    DIMENSIONS: SUPPORT_CROSS,
    STEEL_COLOR,
    createMaterial: createSupportCrossMaterial,
    create: createSupportCross,
    getMeshes: getSupportCrossMeshes
};
