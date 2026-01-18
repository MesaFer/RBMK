/**
 * RBMK-1000 E Shield Module (Схема "Е")
 * Creates the upper biological shield - a cylindrical drum with channel holes
 * 
 * "Схема "Е" представляет собой сварной цилиндрический барабан, собранный 
 * из верхней и нижней трубных плит (решёток), соединённых обечайкой. 
 * В трубные плиты вварены трубные проходки для всех каналов реактора."
 * 
 * Dimensions:
 * - Diameter: 17 m (1700 cm)
 * - Height: 3 m (300 cm)
 * - Form: Cylindrical drum
 * 
 * Key Functions:
 * - Upper biological shield of the reactor
 * - Support for technological channels, CPS channels and special channels
 * - Support for plate flooring and upper reactor piping
 * 
 * Filling: Serpentinite (for biological shielding) - same as Схема "ОР"
 */

// E Shield dimensions based on RBMK specifications
const E_SHIELD = {
    // Shield dimensions
    DIAMETER: 1700,         // cm - 17 meters outer diameter
    HEIGHT: 300,            // cm - 3 meters thickness/height
    
    // Shell (обечайка) thickness
    SHELL_THICKNESS: 10,    // cm - outer cylindrical shell
    
    // Top and bottom plates (трубные плиты)
    PLATE_THICKNESS: 5,     // cm - thickness of top/bottom plates
    
    // Position - above the active zone with 0.5m gap
    // Active zone top is at Y = CORE_HEIGHT (700 cm)
    // Gap of 50cm between active zone and E shield
    // E shield: bottom at 750cm, top at 1050cm, center at 900cm
    POSITION_Y: 900,        // cm - center of E shield (bottom at 750, top at 1050)
    
    // Channel hole diameter (same as in active zone)
    CHANNEL_HOLE_DIAMETER: 11.4,  // cm - pressure tube outer diameter
    
    // Channel tube that passes through the shield
    CHANNEL_TUBE_WALL: 1.0,  // cm - wall thickness of channel tubes
};

// Material colors (same as OR shield for consistency)
const E_SHIELD_COLOR = { r: 0.45, g: 0.45, b: 0.5 };      // Steel shell
const E_SERPENTINITE_COLOR = { r: 0.35, g: 0.4, b: 0.35 }; // Green-gray serpentinite
const E_TUBE_COLOR = { r: 0.5, g: 0.5, b: 0.55 };         // Steel tubes

/**
 * Create materials for the E shield
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {Object} Materials object
 */
function createEShieldMaterials(scene) {
    const materials = {};
    
    // Steel shell material
    materials.shell = new BABYLON.StandardMaterial('eShellMat', scene);
    materials.shell.diffuseColor = new BABYLON.Color3(E_SHIELD_COLOR.r, E_SHIELD_COLOR.g, E_SHIELD_COLOR.b);
    materials.shell.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    
    // Serpentinite fill material
    materials.fill = new BABYLON.StandardMaterial('eSerpentiniteMat', scene);
    materials.fill.diffuseColor = new BABYLON.Color3(E_SERPENTINITE_COLOR.r, E_SERPENTINITE_COLOR.g, E_SERPENTINITE_COLOR.b);
    materials.fill.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    
    // Channel tube material
    materials.tube = new BABYLON.StandardMaterial('eTubeMat', scene);
    materials.tube.diffuseColor = new BABYLON.Color3(E_TUBE_COLOR.r, E_TUBE_COLOR.g, E_TUBE_COLOR.b);
    materials.tube.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    
    return materials;
}

/**
 * Create a single material for simplified version
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {BABYLON.StandardMaterial} Shield material
 */
function createEShieldMaterial(scene) {
    const material = new BABYLON.StandardMaterial('eShieldMat', scene);
    material.diffuseColor = new BABYLON.Color3(E_SHIELD_COLOR.r, E_SHIELD_COLOR.g, E_SHIELD_COLOR.b);
    material.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    return material;
}

/**
 * Create the E shield (Схема "Е") - shell and serpentinite fill only
 * Channel tubes are now handled by the ChannelTracts module
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {Array} coreLayout - Core layout (not used, kept for API compatibility)
 * @param {Object} materials - Materials object (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @param {Function} onProgress - Progress callback (not used, kept for API compatibility)
 * @returns {Promise<Object>} Object containing shield meshes
 */
async function createEShield(scene, coreLayout, materials = null, scale = 0.01, onProgress = null) {
    if (!materials || !materials.shell) {
        materials = createEShieldMaterials(scene);
    }
    
    const meshes = {
        shell: null,
        fill: null,
        all: []
    };
    
    const diameter = E_SHIELD.DIAMETER * scale;
    const height = E_SHIELD.HEIGHT * scale;
    const positionY = E_SHIELD.POSITION_Y * scale;
    const shellThickness = E_SHIELD.SHELL_THICKNESS * scale;
    
    console.log(`Creating E Shield (Схема "Е"): diameter=${E_SHIELD.DIAMETER}cm, height=${E_SHIELD.HEIGHT}cm, positionY=${E_SHIELD.POSITION_Y}cm`);
    
    // Create outer cylindrical shell (обечайка)
    const outerRadius = diameter / 2;
    const innerRadius = outerRadius - shellThickness;
    
    // Create shell as a hollow cylinder using CSG
    const outerCyl = BABYLON.MeshBuilder.CreateCylinder('eOuter', {
        diameter: diameter,
        height: height,
        tessellation: 64
    }, scene);
    
    const innerCyl = BABYLON.MeshBuilder.CreateCylinder('eInner', {
        diameter: innerRadius * 2,
        height: height + 0.1,
        tessellation: 64
    }, scene);
    
    const outerCSG = BABYLON.CSG.FromMesh(outerCyl);
    const innerCSG = BABYLON.CSG.FromMesh(innerCyl);
    const shellCSG = outerCSG.subtract(innerCSG);
    
    const shell = shellCSG.toMesh('eShell', materials.shell, scene);
    shell.position.y = positionY;
    meshes.shell = shell;
    meshes.all.push(shell);
    
    outerCyl.dispose();
    innerCyl.dispose();
    
    // Create fill (serpentinite) as solid cylinder inside the shell
    const fill = BABYLON.MeshBuilder.CreateCylinder('eFill', {
        diameter: innerRadius * 2 - 0.01,
        height: height - 0.01,
        tessellation: 64
    }, scene);
    fill.material = materials.fill;
    fill.position.y = positionY;
    meshes.fill = fill;
    meshes.all.push(fill);
    
    console.log(`E Shield (Схема "Е") created: shell + fill (channel tubes handled by ChannelTracts)`);
    
    return meshes;
}

/**
 * Create a simplified E shield (without individual tubes - for performance)
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {BABYLON.StandardMaterial} material - Shield material (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @returns {Object} Object containing shield meshes
 */
function createEShieldSimplified(scene, material = null, scale = 0.01) {
    if (!material) {
        material = createEShieldMaterial(scene);
    }
    
    const meshes = {
        shield: null,
        all: []
    };
    
    const diameter = E_SHIELD.DIAMETER * scale;
    const height = E_SHIELD.HEIGHT * scale;
    const positionY = E_SHIELD.POSITION_Y * scale;
    
    // Create simple solid cylinder
    const shield = BABYLON.MeshBuilder.CreateCylinder('eShieldSimple', {
        diameter: diameter,
        height: height,
        tessellation: 64
    }, scene);
    
    shield.material = material;
    shield.position.y = positionY;
    meshes.shield = shield;
    meshes.all.push(shield);
    
    console.log(`E Shield (Схема "Е") simplified created`);
    
    return meshes;
}

/**
 * Get all meshes from the E shield for export
 * @param {Object} shieldMeshes - Meshes object from createEShield()
 * @returns {Array} Array of all meshes
 */
function getEShieldMeshes(shieldMeshes) {
    return shieldMeshes.all || [];
}

// Export functions
window.EShield = {
    DIMENSIONS: E_SHIELD,
    SHIELD_COLOR: E_SHIELD_COLOR,
    SERPENTINITE_COLOR: E_SERPENTINITE_COLOR,
    TUBE_COLOR: E_TUBE_COLOR,
    createMaterial: createEShieldMaterial,
    createMaterials: createEShieldMaterials,
    create: createEShield,
    createSimplified: createEShieldSimplified,
    getMeshes: getEShieldMeshes
};
