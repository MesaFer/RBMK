/**
 * RBMK-1000 OR Shield Module (Схема "ОР")
 * Creates the lower biological shield - a cylindrical drum with channel holes
 * 
 * "Металлоконструкция схемы "ОР" выполнена в виде барабана диаметром 14,5 м 
 * и высотой 2 м, собрана из трубных плит и обечайки."
 * 
 * "Нижняя плита толщиной 2 м и диаметром 14,5 м состоит из цилиндрической 
 * обечайки и двух листов, в которые герметично вварены трубные проходки 
 * для топливных каналов и каналов управления. Весь объём внутри плиты 
 * между проходками заполнен серпентинитом."
 * 
 * Filling: Serpentinite (for biological shielding)
 */

// OR Shield dimensions based on actual RBMK specifications
const OR_SHIELD = {
    // Shield dimensions
    DIAMETER: 1450,         // cm - 14.5 meters outer diameter
    HEIGHT: 200,            // cm - 2 meters thickness/height
    
    // Shell (обечайка) thickness
    SHELL_THICKNESS: 10,    // cm - outer cylindrical shell
    
    // Top and bottom plates
    PLATE_THICKNESS: 5,     // cm - thickness of top/bottom plates
    
    // Position - directly below the active zone
    // Active zone bottom is at Y=0
    POSITION_Y: -100,       // cm - center of OR shield (top at 0, bottom at -200)
    
    // Channel hole diameter (same as in active zone)
    CHANNEL_HOLE_DIAMETER: 11.4,  // cm - pressure tube outer diameter
    
    // Channel tube that passes through the shield
    CHANNEL_TUBE_WALL: 1.0,  // cm - wall thickness of channel tubes
};

// Material colors
const SHIELD_COLOR = { r: 0.45, g: 0.45, b: 0.5 };      // Steel shell
const SERPENTINITE_COLOR = { r: 0.35, g: 0.4, b: 0.35 }; // Green-gray serpentinite
const TUBE_COLOR = { r: 0.5, g: 0.5, b: 0.55 };         // Steel tubes

/**
 * Create materials for the OR shield
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {Object} Materials object
 */
function createORShieldMaterials(scene) {
    const materials = {};
    
    // Steel shell material
    materials.shell = new BABYLON.StandardMaterial('orShellMat', scene);
    materials.shell.diffuseColor = new BABYLON.Color3(SHIELD_COLOR.r, SHIELD_COLOR.g, SHIELD_COLOR.b);
    materials.shell.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    
    // Serpentinite fill material
    materials.fill = new BABYLON.StandardMaterial('serpentiniteMat', scene);
    materials.fill.diffuseColor = new BABYLON.Color3(SERPENTINITE_COLOR.r, SERPENTINITE_COLOR.g, SERPENTINITE_COLOR.b);
    materials.fill.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    
    // Channel tube material
    materials.tube = new BABYLON.StandardMaterial('orTubeMat', scene);
    materials.tube.diffuseColor = new BABYLON.Color3(TUBE_COLOR.r, TUBE_COLOR.g, TUBE_COLOR.b);
    materials.tube.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    
    return materials;
}

/**
 * Create a single material for simplified version
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {BABYLON.StandardMaterial} Shield material
 */
function createORShieldMaterial(scene) {
    const material = new BABYLON.StandardMaterial('orShieldMat', scene);
    material.diffuseColor = new BABYLON.Color3(SHIELD_COLOR.r, SHIELD_COLOR.g, SHIELD_COLOR.b);
    material.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    return material;
}

/**
 * Create the OR shield (Схема "ОР") - shell and serpentinite fill only
 * Channel tubes are now handled by the ChannelTracts module
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {Array} coreLayout - Core layout (not used, kept for API compatibility)
 * @param {Object} materials - Materials object (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @param {Function} onProgress - Progress callback (not used, kept for API compatibility)
 * @returns {Promise<Object>} Object containing shield meshes
 */
async function createORShield(scene, coreLayout, materials = null, scale = 0.01, onProgress = null) {
    if (!materials || !materials.shell) {
        materials = createORShieldMaterials(scene);
    }
    
    const meshes = {
        shell: null,
        fill: null,
        all: []
    };
    
    const diameter = OR_SHIELD.DIAMETER * scale;
    const height = OR_SHIELD.HEIGHT * scale;
    const positionY = OR_SHIELD.POSITION_Y * scale;
    const shellThickness = OR_SHIELD.SHELL_THICKNESS * scale;
    
    console.log(`Creating OR Shield (Схема "ОР"): diameter=${OR_SHIELD.DIAMETER}cm, height=${OR_SHIELD.HEIGHT}cm`);
    
    // Create outer cylindrical shell (обечайка)
    const outerRadius = diameter / 2;
    const innerRadius = outerRadius - shellThickness;
    
    // Create shell as a hollow cylinder using CSG
    const outerCyl = BABYLON.MeshBuilder.CreateCylinder('orOuter', {
        diameter: diameter,
        height: height,
        tessellation: 64
    }, scene);
    
    const innerCyl = BABYLON.MeshBuilder.CreateCylinder('orInner', {
        diameter: innerRadius * 2,
        height: height + 0.1,
        tessellation: 64
    }, scene);
    
    const outerCSG = BABYLON.CSG.FromMesh(outerCyl);
    const innerCSG = BABYLON.CSG.FromMesh(innerCyl);
    const shellCSG = outerCSG.subtract(innerCSG);
    
    const shell = shellCSG.toMesh('orShell', materials.shell, scene);
    shell.position.y = positionY;
    meshes.shell = shell;
    meshes.all.push(shell);
    
    outerCyl.dispose();
    innerCyl.dispose();
    
    // Create fill (serpentinite) as solid cylinder inside the shell
    const fill = BABYLON.MeshBuilder.CreateCylinder('orFill', {
        diameter: innerRadius * 2 - 0.01,
        height: height - 0.01,
        tessellation: 64
    }, scene);
    fill.material = materials.fill;
    fill.position.y = positionY;
    meshes.fill = fill;
    meshes.all.push(fill);
    
    console.log(`OR Shield (Схема "ОР") created: shell + fill (channel tubes handled by ChannelTracts)`);
    
    return meshes;
}

/**
 * Create a simplified OR shield (without individual tubes - for performance)
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {BABYLON.StandardMaterial} material - Shield material (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @returns {Object} Object containing shield meshes
 */
function createORShieldSimplified(scene, material = null, scale = 0.01) {
    if (!material) {
        material = createORShieldMaterial(scene);
    }
    
    const meshes = {
        shield: null,
        all: []
    };
    
    const diameter = OR_SHIELD.DIAMETER * scale;
    const height = OR_SHIELD.HEIGHT * scale;
    const positionY = OR_SHIELD.POSITION_Y * scale;
    
    // Create simple solid cylinder
    const shield = BABYLON.MeshBuilder.CreateCylinder('orShieldSimple', {
        diameter: diameter,
        height: height,
        tessellation: 64
    }, scene);
    
    shield.material = material;
    shield.position.y = positionY;
    meshes.shield = shield;
    meshes.all.push(shield);
    
    console.log(`OR Shield (Схема "ОР") simplified created`);
    
    return meshes;
}

/**
 * Get all meshes from the OR shield for export
 * @param {Object} shieldMeshes - Meshes object from createORShield()
 * @returns {Array} Array of all meshes
 */
function getORShieldMeshes(shieldMeshes) {
    return shieldMeshes.all || [];
}

// Export functions
window.ORShield = {
    DIMENSIONS: OR_SHIELD,
    SHIELD_COLOR,
    SERPENTINITE_COLOR,
    TUBE_COLOR,
    createMaterial: createORShieldMaterial,
    createMaterials: createORShieldMaterials,
    create: createORShield,
    createSimplified: createORShieldSimplified,
    getMeshes: getORShieldMeshes
};
