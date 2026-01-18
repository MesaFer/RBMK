/**
 * RBMK-1000 L Shell Module (Схема "Л")
 * Creates the main reactor vessel/shell - the outermost cylindrical containment
 * 
 * Схема "Л" (Корпус реактора) - основная цилиндрическая оболочка,
 * внутри которой находится вся конструкция реактора.
 * 
 * Конструкция:
 * - Герметичный сварной цилиндрический корпус
 * - Цилиндрическая обечайка (боковая стенка)
 * - Верхняя часть приварена к Схеме "Д" (верхняя плита)
 * - Нижняя часть приварена к Схеме "ОР" (нижняя плита)
 * - Материал: Сталь 10ХСНД
 * 
 * Функции:
 * - Герметизация полости реактора
 * - Заполнение инертной газовой смесью (гелий + азот)
 * - НЕ является сосудом высокого давления (давление близко к атмосферному)
 * 
 * Dimensions:
 * - Inner diameter: ~14 m
 * - Outer diameter: ~14.5 m
 * - Cylindrical height: ~9.5 m
 * - Wall thickness: 16-25 mm (using 20mm average)
 */

// L Shell dimensions based on RBMK specifications
const L_SHELL = {
    // Dimensions in cm
    INNER_DIAMETER: 1400,       // cm - 14 m inner diameter
    OUTER_DIAMETER: 1450,       // cm - 14.5 m outer diameter
    HEIGHT: 950,                // cm - 9.5 m cylindrical height
    
    // Wall thickness (16-25mm, using 20mm average)
    WALL_THICKNESS: 2.0,        // cm - 20 mm wall thickness
    
    // Position - centered on active zone
    // Active zone: bottom at Y=0, top at Y=700cm, center at Y=350cm
    // L Shell extends from below OR shield to above E shield
    // OR shield: bottom at -200cm, E shield: top at 1050cm
    // L Shell should encompass both: from -250cm to 1100cm, center at 425cm
    POSITION_Y: 425,            // cm - center of L shell
    
    // Bottom and top plate thickness (optional, for visual completeness)
    PLATE_THICKNESS: 5.0,       // cm - top/bottom closure plates
};

// Material colors
const L_SHELL_COLOR = { r: 0.55, g: 0.55, b: 0.6 };      // Steel shell (light gray)
const L_GAS_COLOR = { r: 0.4, g: 0.5, b: 0.45 };         // He-N2 gas mixture (greenish)

/**
 * Create materials for the L shell
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {Object} Materials object
 */
function createLShellMaterials(scene) {
    const materials = {};
    
    // Steel shell material
    materials.shell = new BABYLON.StandardMaterial('lShellMat', scene);
    materials.shell.diffuseColor = new BABYLON.Color3(L_SHELL_COLOR.r, L_SHELL_COLOR.g, L_SHELL_COLOR.b);
    materials.shell.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    
    // Gas gap material (semi-transparent for visualization)
    materials.gas = new BABYLON.StandardMaterial('lGasMat', scene);
    materials.gas.diffuseColor = new BABYLON.Color3(L_GAS_COLOR.r, L_GAS_COLOR.g, L_GAS_COLOR.b);
    materials.gas.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    materials.gas.alpha = 0.2;
    materials.gas.backFaceCulling = false;
    
    return materials;
}

/**
 * Create a single material for simplified version
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {BABYLON.StandardMaterial} Shell material
 */
function createLShellMaterial(scene) {
    const material = new BABYLON.StandardMaterial('lShellMat', scene);
    material.diffuseColor = new BABYLON.Color3(L_SHELL_COLOR.r, L_SHELL_COLOR.g, L_SHELL_COLOR.b);
    material.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    return material;
}

/**
 * Create the L shell (Схема "Л") - reactor vessel
 * Creates the main cylindrical shell with optional gas gap visualization
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {Object} materials - Materials object (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Object>} Object containing shell meshes
 */
async function createLShell(scene, materials = null, scale = 0.01, onProgress = null) {
    if (!materials || !materials.shell) {
        materials = createLShellMaterials(scene);
    }
    
    const meshes = {
        shell: null,
        gasGap: null,
        all: []
    };
    
    const innerDiameter = L_SHELL.INNER_DIAMETER * scale;
    const outerDiameter = L_SHELL.OUTER_DIAMETER * scale;
    const height = L_SHELL.HEIGHT * scale;
    const positionY = L_SHELL.POSITION_Y * scale;
    const wallThickness = L_SHELL.WALL_THICKNESS * scale;
    
    console.log(`Creating L Shell (Схема "Л"): inner Ø=${L_SHELL.INNER_DIAMETER}cm, outer Ø=${L_SHELL.OUTER_DIAMETER}cm, height=${L_SHELL.HEIGHT}cm`);
    
    // Calculate radii
    const outerRadius = outerDiameter / 2;
    const innerRadius = innerDiameter / 2;
    
    // Create main cylindrical shell (hollow cylinder)
    const shellOuter = BABYLON.MeshBuilder.CreateCylinder('lShellOuter', {
        diameter: outerDiameter,
        height: height,
        tessellation: 64
    }, scene);
    
    const shellInner = BABYLON.MeshBuilder.CreateCylinder('lShellInner', {
        diameter: innerDiameter,
        height: height + 0.1,
        tessellation: 64
    }, scene);
    
    const shellOuterCSG = BABYLON.CSG.FromMesh(shellOuter);
    const shellInnerCSG = BABYLON.CSG.FromMesh(shellInner);
    const shellCSG = shellOuterCSG.subtract(shellInnerCSG);
    
    const shell = shellCSG.toMesh('lShell', materials.shell, scene);
    shell.position.y = positionY;
    meshes.shell = shell;
    meshes.all.push(shell);
    
    shellOuter.dispose();
    shellInner.dispose();
    
    if (onProgress) onProgress(50);
    
    // Create gas gap visualization (between KZH outer and L shell inner)
    // KZH outer diameter is 13m (1300cm), L shell inner is 14m (1400cm)
    // Gas gap: from 1300cm to 1400cm diameter
    const kzhOuterDiameter = 1300 * scale;  // From KZH_COOLING.OUTER_DIAMETER
    const gasGapOuterR = innerRadius;       // L shell inner radius
    const gasGapInnerR = kzhOuterDiameter / 2;  // KZH outer radius
    
    // Only create gas gap if there's actually a gap
    if (gasGapOuterR > gasGapInnerR) {
        const gasOuter = BABYLON.MeshBuilder.CreateCylinder('lGasOuter', {
            diameter: gasGapOuterR * 2,
            height: 700 * scale,  // Active zone height
            tessellation: 64
        }, scene);
        
        const gasInner = BABYLON.MeshBuilder.CreateCylinder('lGasInner', {
            diameter: gasGapInnerR * 2,
            height: 700 * scale + 0.1,
            tessellation: 64
        }, scene);
        
        const gasOuterCSG = BABYLON.CSG.FromMesh(gasOuter);
        const gasInnerCSG = BABYLON.CSG.FromMesh(gasInner);
        const gasCSG = gasOuterCSG.subtract(gasInnerCSG);
        
        const gasGap = gasCSG.toMesh('lGasGap', materials.gas, scene);
        gasGap.position.y = 350 * scale;  // Centered on active zone
        meshes.gasGap = gasGap;
        meshes.all.push(gasGap);
        
        gasOuter.dispose();
        gasInner.dispose();
    }
    
    if (onProgress) onProgress(100);
    
    console.log(`L Shell (Схема "Л") created: main shell + gas gap visualization`);
    
    return meshes;
}

/**
 * Create a simplified L shell (just the outer cylinder)
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {BABYLON.StandardMaterial} material - Material (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @returns {Object} Object containing shell meshes
 */
function createLShellSimplified(scene, material = null, scale = 0.01) {
    if (!material) {
        material = createLShellMaterial(scene);
    }
    
    const meshes = {
        shell: null,
        all: []
    };
    
    const innerDiameter = L_SHELL.INNER_DIAMETER * scale;
    const outerDiameter = L_SHELL.OUTER_DIAMETER * scale;
    const height = L_SHELL.HEIGHT * scale;
    const positionY = L_SHELL.POSITION_Y * scale;
    
    // Create as single hollow cylinder
    const outer = BABYLON.MeshBuilder.CreateCylinder('lOuter', {
        diameter: outerDiameter,
        height: height,
        tessellation: 64
    }, scene);
    
    const inner = BABYLON.MeshBuilder.CreateCylinder('lInner', {
        diameter: innerDiameter,
        height: height + 0.1,
        tessellation: 64
    }, scene);
    
    const outerCSG = BABYLON.CSG.FromMesh(outer);
    const innerCSG = BABYLON.CSG.FromMesh(inner);
    const shellCSG = outerCSG.subtract(innerCSG);
    
    const shell = shellCSG.toMesh('lShellSimple', material, scene);
    shell.position.y = positionY;
    meshes.shell = shell;
    meshes.all.push(shell);
    
    outer.dispose();
    inner.dispose();
    
    console.log(`L Shell (Схема "Л") simplified created`);
    
    return meshes;
}

/**
 * Get all meshes from the L shell for export
 * @param {Object} shellMeshes - Meshes object from createLShell()
 * @returns {Array} Array of all meshes
 */
function getLShellMeshes(shellMeshes) {
    return shellMeshes.all || [];
}

// Export functions
window.LShell = {
    DIMENSIONS: L_SHELL,
    SHELL_COLOR: L_SHELL_COLOR,
    GAS_COLOR: L_GAS_COLOR,
    createMaterial: createLShellMaterial,
    createMaterials: createLShellMaterials,
    create: createLShell,
    createSimplified: createLShellSimplified,
    getMeshes: getLShellMeshes
};
