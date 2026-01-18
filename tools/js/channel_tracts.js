/**
 * RBMK-1000 Technological Channel Tracts Module (Тракты ТК)
 * Creates the full-height technological channels that pass through the entire reactor
 * 
 * Structure (bottom to top):
 * - Lower tract: 57×5mm, ~8m, Steel 08Х18Н10Т (passes through OR shield and below)
 * - Active zone channel: 88×4mm, 7m, Zr+2.5%Nb alloy (in the graphite stack)
 * - Upper tract: 57×5mm, ~8m, Steel 08Х18Н10Т (passes through E shield and above)
 * 
 * The channel is a continuous vertical tube passing through:
 * - Support Cross (Схема "С")
 * - OR Shield (Схема "ОР") - lower biological shield
 * - Active Zone (graphite stack)
 * - Gap (0.5m)
 * - E Shield (Схема "Е") - upper biological shield
 */

// Channel tract dimensions based on RBMK specifications
const CHANNEL_TRACTS = {
    // Lower tract (below active zone, through OR shield)
    LOWER_TRACT: {
        OUTER_DIAMETER: 5.7,    // cm - 57mm outer diameter
        WALL_THICKNESS: 0.5,    // cm - 5mm wall
        LENGTH: 800,            // cm - ~8 meters
    },
    
    // Active zone channel (in graphite stack)
    ACTIVE_ZONE: {
        OUTER_DIAMETER: 8.8,    // cm - 88mm outer diameter
        WALL_THICKNESS: 0.4,    // cm - 4mm wall
        LENGTH: 700,            // cm - 7 meters (core height)
    },
    
    // Upper tract (above active zone, through E shield)
    UPPER_TRACT: {
        OUTER_DIAMETER: 5.7,    // cm - 57mm outer diameter
        WALL_THICKNESS: 0.5,    // cm - 5mm wall
        LENGTH: 800,            // cm - ~8 meters
    },
    
    // Gap between active zone top and E shield bottom
    GAP_HEIGHT: 50,             // cm - 0.5 meters gap
    
    // Vertical positions (Y coordinates)
    // Active zone: bottom at Y=0, top at Y=700
    // OR shield: center at Y=-100 (top at 0, bottom at -200)
    // E shield: center at Y=900 (bottom at 750, top at 1050) - with 50cm gap
    POSITIONS: {
        ACTIVE_ZONE_BOTTOM: 0,
        ACTIVE_ZONE_TOP: 700,
        OR_SHIELD_TOP: 0,
        OR_SHIELD_BOTTOM: -200,
        E_SHIELD_BOTTOM: 750,   // 700 + 50cm gap
        E_SHIELD_TOP: 1050,     // 750 + 300cm height
    }
};

// Material colors
const TRACT_STEEL_COLOR = { r: 0.5, g: 0.5, b: 0.55 };        // Steel 08Х18Н10Т
const TRACT_ZIRCONIUM_COLOR = { r: 0.6, g: 0.55, b: 0.5 };    // Zr+2.5%Nb alloy (slightly warmer)

/**
 * Create materials for channel tracts
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @returns {Object} Materials object
 */
function createChannelTractMaterials(scene) {
    const materials = {};
    
    // Steel material for lower and upper tracts
    materials.steel = new BABYLON.StandardMaterial('tractSteelMat', scene);
    materials.steel.diffuseColor = new BABYLON.Color3(TRACT_STEEL_COLOR.r, TRACT_STEEL_COLOR.g, TRACT_STEEL_COLOR.b);
    materials.steel.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    
    // Zirconium alloy material for active zone channel
    materials.zirconium = new BABYLON.StandardMaterial('tractZrMat', scene);
    materials.zirconium.diffuseColor = new BABYLON.Color3(TRACT_ZIRCONIUM_COLOR.r, TRACT_ZIRCONIUM_COLOR.g, TRACT_ZIRCONIUM_COLOR.b);
    materials.zirconium.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    
    return materials;
}

/**
 * Create channel tracts for all channels
 * @param {BABYLON.Scene} scene - Babylon.js scene
 * @param {Array} coreLayout - Core layout from ActiveZone.loadLayout()
 * @param {Object} materials - Materials object (optional)
 * @param {number} scale - Scale factor (default 0.01)
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} Object containing tract meshes
 */
async function createChannelTracts(scene, coreLayout, materials = null, scale = 0.01, onProgress = null) {
    if (!materials) {
        materials = createChannelTractMaterials(scene);
    }
    
    const meshes = {
        lowerTracts: [],
        activeZoneChannels: [],
        upperTracts: [],
        all: []
    };
    
    // Dimensions in scene units
    const lowerDiameter = CHANNEL_TRACTS.LOWER_TRACT.OUTER_DIAMETER * scale;
    const lowerLength = CHANNEL_TRACTS.LOWER_TRACT.LENGTH * scale;
    
    const activeDiameter = CHANNEL_TRACTS.ACTIVE_ZONE.OUTER_DIAMETER * scale;
    const activeLength = CHANNEL_TRACTS.ACTIVE_ZONE.LENGTH * scale;
    
    const upperDiameter = CHANNEL_TRACTS.UPPER_TRACT.OUTER_DIAMETER * scale;
    const upperLength = CHANNEL_TRACTS.UPPER_TRACT.LENGTH * scale;
    
    const gapHeight = CHANNEL_TRACTS.GAP_HEIGHT * scale;
    
    // Y positions
    const activeZoneBottom = CHANNEL_TRACTS.POSITIONS.ACTIVE_ZONE_BOTTOM * scale;
    const activeZoneTop = CHANNEL_TRACTS.POSITIONS.ACTIVE_ZONE_TOP * scale;
    
    console.log(`Creating Channel Tracts: ${coreLayout.length} channels`);
    console.log(`  Lower tract: ${CHANNEL_TRACTS.LOWER_TRACT.OUTER_DIAMETER}mm × ${CHANNEL_TRACTS.LOWER_TRACT.LENGTH}cm`);
    console.log(`  Active zone: ${CHANNEL_TRACTS.ACTIVE_ZONE.OUTER_DIAMETER}mm × ${CHANNEL_TRACTS.ACTIVE_ZONE.LENGTH}cm`);
    console.log(`  Upper tract: ${CHANNEL_TRACTS.UPPER_TRACT.OUTER_DIAMETER}mm × ${CHANNEL_TRACTS.UPPER_TRACT.LENGTH}cm`);
    
    // Create template meshes
    const lowerTemplate = BABYLON.MeshBuilder.CreateCylinder('lowerTractTemplate', {
        diameter: lowerDiameter,
        height: lowerLength,
        tessellation: 8
    }, scene);
    lowerTemplate.material = materials.steel;
    lowerTemplate.isVisible = false;
    
    const activeTemplate = BABYLON.MeshBuilder.CreateCylinder('activeTractTemplate', {
        diameter: activeDiameter,
        height: activeLength,
        tessellation: 12
    }, scene);
    activeTemplate.material = materials.zirconium;
    activeTemplate.isVisible = false;
    
    const upperTemplate = BABYLON.MeshBuilder.CreateCylinder('upperTractTemplate', {
        diameter: upperDiameter,
        height: upperLength,
        tessellation: 8
    }, scene);
    upperTemplate.material = materials.steel;
    upperTemplate.isVisible = false;
    
    // Calculate Y positions for each section
    // Lower tract: extends from below OR shield to bottom of active zone
    const lowerY = activeZoneBottom - lowerLength / 2;
    
    // Active zone channel: in the graphite stack
    const activeY = activeZoneBottom + activeLength / 2;
    
    // Upper tract: starts from top of active zone and extends up through gap and E shield
    // The upper tract fills the gap between active zone and E shield
    const upperY = activeZoneTop + upperLength / 2;
    
    // Create instances for each channel
    let processedCount = 0;
    const totalCount = coreLayout.length;
    const batchSize = 100;
    
    for (let i = 0; i < coreLayout.length; i += batchSize) {
        const batch = coreLayout.slice(i, i + batchSize);
        
        for (const channel of batch) {
            const x = channel.x * scale;
            const z = channel.y * scale;
            
            // Create lower tract instance
            const lower = lowerTemplate.createInstance(`lowerTract_${channel.id}`);
            lower.position.set(x, lowerY, z);
            meshes.lowerTracts.push(lower);
            meshes.all.push(lower);
            
            // Create active zone channel instance
            const active = activeTemplate.createInstance(`activeTract_${channel.id}`);
            active.position.set(x, activeY, z);
            meshes.activeZoneChannels.push(active);
            meshes.all.push(active);
            
            // Create upper tract instance
            const upper = upperTemplate.createInstance(`upperTract_${channel.id}`);
            upper.position.set(x, upperY, z);
            meshes.upperTracts.push(upper);
            meshes.all.push(upper);
            
            processedCount++;
        }
        
        if (onProgress) {
            const progress = (processedCount / totalCount) * 100;
            onProgress(progress);
        }
        
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    console.log(`Channel Tracts created: ${meshes.lowerTracts.length} lower, ${meshes.activeZoneChannels.length} active, ${meshes.upperTracts.length} upper`);
    
    return meshes;
}

/**
 * Get all meshes from channel tracts for export
 * @param {Object} tractMeshes - Meshes object from createChannelTracts()
 * @returns {Array} Array of all meshes
 */
function getChannelTractMeshes(tractMeshes) {
    return tractMeshes.all || [];
}

// Export functions
window.ChannelTracts = {
    DIMENSIONS: CHANNEL_TRACTS,
    STEEL_COLOR: TRACT_STEEL_COLOR,
    ZIRCONIUM_COLOR: TRACT_ZIRCONIUM_COLOR,
    createMaterials: createChannelTractMaterials,
    create: createChannelTracts,
    getMeshes: getChannelTractMeshes
};
