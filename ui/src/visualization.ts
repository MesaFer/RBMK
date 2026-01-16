/**
 * RBMK-1000 Reactor 3D Visualization
 * Using Babylon.js for WebGL rendering
 * 
 * Accurate core layout based on OPB-82 specification
 */

import {
    Engine,
    Scene,
    ArcRotateCamera,
    HemisphericLight,
    PointLight,
    Vector3,
    Color3,
    Color4,
    MeshBuilder,
    StandardMaterial,
    PBRMaterial,
    Mesh,
    InstancedMesh,
    GlowLayer,
    Animation,
} from '@babylonjs/core';

import {
    generateRBMKCoreLayout,
    CoreChannel,
    ChannelType,
    CHANNEL_COLORS,
    getChannelCounts,
} from './rbmk_core_layout';

export interface FuelChannel {
    id: number;
    x: number;
    y: number;
    fuel_temp: number;
    coolant_temp: number;
    coolant_void: number;
    neutron_flux: number;
    burnup: number;
}

export interface ControlRod {
    id: number;
    x: number;
    y: number;
    position: number;
    rod_type: string;
    worth: number;
}

export interface Reactor3DData {
    core_height: number;
    core_radius: number;
    fuel_channels: FuelChannel[];
    control_rods: ControlRod[];
    axial_flux: number[];
    power_distribution: number[][];
}

// Scale factor for visualization
const SCALE = 0.01; // cm to scene units
const CORE_HEIGHT = 700; // cm
const CORE_RADIUS = 593; // cm
const GRID_SPACING = 25; // cm

export class ReactorVisualization {
    private engine: Engine;
    private scene: Scene;
    private camera: ArcRotateCamera;
    
    // Core layout
    private coreLayout: CoreChannel[] = [];
    
    // Meshes
    private coreMesh: Mesh | null = null;
    private waterMesh: Mesh | null = null;
    private topShieldMesh: Mesh | null = null;
    private bottomShieldMesh: Mesh | null = null;
    private channelMeshes: Map<number, Mesh | InstancedMesh> = new Map();
    private rodMeshes: Map<number, Mesh> = new Map();
    
    // Materials
    private materials: Map<ChannelType, StandardMaterial> = new Map();
    private graphiteMaterial: PBRMaterial | null = null;
    private waterMaterial: StandardMaterial | null = null;
    
    private glowLayer: GlowLayer | null = null;
    
    // Transparency control
    private coreTransparency: number = 0.7;
    
    // Rod positions by type (0 = fully inserted, 1 = fully withdrawn)
    private rodPositions: Map<ChannelType, number> = new Map([
        ['RR', 0.8],   // Manual rods - 80% withdrawn
        ['AR', 0.8],   // Automatic rods
        ['LAR', 0.8],  // Local automatic
        ['USP', 0.8],  // Shortened absorbers (from below)
        ['AZ', 0.8],   // Emergency rods
    ]);
    
    private canvas: HTMLCanvasElement;
    private resizeObserver: ResizeObserver | null = null;
    
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.engine = new Engine(canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true,
            adaptToDeviceRatio: true,
        });
        
        this.scene = new Scene(this.engine);
        this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);
        
        // Setup camera
        this.camera = new ArcRotateCamera(
            'camera',
            Math.PI / 4,
            Math.PI / 3,
            20,
            Vector3.Zero(),
            this.scene
        );
        this.camera.attachControl(canvas, true);
        this.camera.wheelPrecision = 30;
        this.camera.minZ = 0.1;
        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 50;
        
        // Generate core layout
        this.coreLayout = generateRBMKCoreLayout();
        console.log('Core layout generated:', getChannelCounts(this.coreLayout));
        
        // Setup lighting
        this.setupLighting();
        
        // Create materials
        this.createMaterials();
        
        // Create glow layer for radioactive effect
        this.glowLayer = new GlowLayer('glow', this.scene);
        this.glowLayer.intensity = 0.5;
        
        // Initialize reactor geometry
        this.initializeReactorGeometry();
        
        // Start render loop
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
        
        // Handle resize
        this.setupResizeHandling();
    }
    
    private setupResizeHandling(): void {
        window.addEventListener('resize', () => {
            this.handleResize();
        });
        
        const container = this.canvas.parentElement;
        if (container && typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.handleResize();
            });
            this.resizeObserver.observe(container);
        }
        
        setTimeout(() => this.handleResize(), 100);
    }
    
    private handleResize(): void {
        const container = this.canvas.parentElement;
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                this.canvas.width = rect.width;
                this.canvas.height = rect.height;
            }
        }
        this.engine.resize();
    }
    
    private setupLighting(): void {
        // Ambient light
        const ambient = new HemisphericLight(
            'ambient',
            new Vector3(0, 1, 0),
            this.scene
        );
        ambient.intensity = 0.5;
        ambient.diffuse = new Color3(0.9, 0.9, 1);
        ambient.groundColor = new Color3(0.3, 0.3, 0.4);
        
        // Main light from above
        const mainLight = new PointLight(
            'mainLight',
            new Vector3(0, 15, 5),
            this.scene
        );
        mainLight.intensity = 1.2;
        mainLight.diffuse = new Color3(1, 0.95, 0.9);
        
        // Core glow light (Cherenkov radiation effect)
        const coreLight = new PointLight(
            'coreLight',
            new Vector3(0, 3.5, 0),
            this.scene
        );
        coreLight.intensity = 0.3;
        coreLight.diffuse = new Color3(0.3, 0.5, 1);
    }
    
    private createMaterials(): void {
        // Create materials for each channel type
        for (const [type, color] of Object.entries(CHANNEL_COLORS)) {
            const mat = new StandardMaterial(`mat_${type}`, this.scene);
            mat.diffuseColor = new Color3(color.r, color.g, color.b);
            mat.specularColor = new Color3(0.3, 0.3, 0.3);
            
            // Add emissive glow for control rods
            if (type !== 'TK' && type !== 'GRAPHITE') {
                mat.emissiveColor = new Color3(color.r * 0.2, color.g * 0.2, color.b * 0.2);
            }
            
            this.materials.set(type as ChannelType, mat);
        }
        
        // Graphite material (semi-transparent)
        this.graphiteMaterial = new PBRMaterial('graphiteMat', this.scene);
        this.graphiteMaterial.albedoColor = new Color3(0.35, 0.35, 0.4);
        this.graphiteMaterial.metallic = 0;
        this.graphiteMaterial.roughness = 0.9;
        this.graphiteMaterial.alpha = 1 - this.coreTransparency;
        
        // Water/coolant material
        this.waterMaterial = new StandardMaterial('waterMat', this.scene);
        this.waterMaterial.diffuseColor = new Color3(0.2, 0.4, 0.9);
        this.waterMaterial.alpha = 0.2;
        this.waterMaterial.emissiveColor = new Color3(0.05, 0.1, 0.3);
    }
    
    private initializeReactorGeometry(): void {
        const coreHeight = CORE_HEIGHT * SCALE;
        const coreRadius = CORE_RADIUS * SCALE;
        
        // Create core vessel (graphite moderator)
        this.coreMesh = MeshBuilder.CreateCylinder('core', {
            height: coreHeight,
            diameter: coreRadius * 2,
            tessellation: 64,
        }, this.scene);
        this.coreMesh.material = this.graphiteMaterial;
        this.coreMesh.position.y = coreHeight / 2;
        
        // Create top biological shield
        this.topShieldMesh = MeshBuilder.CreateCylinder('topShield', {
            height: 0.3,
            diameter: coreRadius * 2.1,
            tessellation: 64,
        }, this.scene);
        const shieldMat = new StandardMaterial('shieldMat', this.scene);
        shieldMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
        shieldMat.alpha = 1 - this.coreTransparency;
        this.topShieldMesh.material = shieldMat;
        this.topShieldMesh.position.y = coreHeight + 0.15;
        
        // Create bottom shield
        this.bottomShieldMesh = MeshBuilder.CreateCylinder('bottomShield', {
            height: 0.3,
            diameter: coreRadius * 2.1,
            tessellation: 64,
        }, this.scene);
        this.bottomShieldMesh.material = shieldMat;
        this.bottomShieldMesh.position.y = -0.15;
        
        // Create water pool
        this.waterMesh = MeshBuilder.CreateCylinder('water', {
            height: coreHeight * 0.95,
            diameter: coreRadius * 1.9,
            tessellation: 64,
        }, this.scene);
        this.waterMesh.material = this.waterMaterial;
        this.waterMesh.position.y = coreHeight / 2;
        
        // Create channels based on core layout
        this.createChannels();
        
        // Apply initial transparency
        this.setCoreTransparency(this.coreTransparency);
    }
    
    private createChannels(): void {
        const coreHeight = CORE_HEIGHT * SCALE;
        const channelRadius = 0.03; // Visual radius for fuel channels
        const rodRadius = 0.045;    // Slightly larger for control rods
        
        // Create shared material for fuel channels
        const fuelMaterial = new StandardMaterial('fuelMat', this.scene);
        const baseColor = CHANNEL_COLORS.TK;
        fuelMaterial.diffuseColor = new Color3(baseColor.r, baseColor.g, baseColor.b);
        fuelMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
        fuelMaterial.emissiveColor = new Color3(0.05, 0.03, 0);
        
        // Create template mesh for fuel channels
        const fuelTemplate = MeshBuilder.CreateCylinder('fuelTemplate', {
            height: coreHeight * 1.02,
            diameter: channelRadius * 2,
            tessellation: 6,
        }, this.scene);
        fuelTemplate.material = fuelMaterial;
        fuelTemplate.isVisible = false;
        
        // Count channels for logging
        let fuelCount = 0;
        let rodCount = 0;
        
        // Create channels
        for (const channel of this.coreLayout) {
            const x = channel.x * SCALE;
            const z = channel.y * SCALE;
            
            if (channel.type === 'TK') {
                // Fuel channels - use thin instances for better performance
                const instance = fuelTemplate.createInstance(`fuel_${channel.id}`);
                instance.position.set(x, coreHeight / 2, z);
                this.channelMeshes.set(channel.id, instance);
                fuelCount++;
            } else {
                // Control rods - individual meshes with their own materials
                const rod = MeshBuilder.CreateCylinder(`rod_${channel.id}`, {
                    height: coreHeight,
                    diameter: rodRadius * 2,
                    tessellation: 8,
                }, this.scene);
                
                rod.position.set(x, coreHeight / 2, z);
                rod.material = this.materials.get(channel.type)!;
                
                this.rodMeshes.set(channel.id, rod);
                this.channelMeshes.set(channel.id, rod);
                rodCount++;
            }
        }
        
        console.log(`Created ${fuelCount} fuel channels and ${rodCount} control rods`);
        
        // Keep template for instancing (don't dispose)
        fuelTemplate.setEnabled(false);
    }
    
    /**
     * Set core transparency (0 = opaque, 1 = fully transparent)
     */
    public setCoreTransparency(value: number): void {
        this.coreTransparency = Math.max(0, Math.min(1, value));
        
        if (this.graphiteMaterial) {
            this.graphiteMaterial.alpha = 1 - this.coreTransparency;
        }
        
        if (this.coreMesh) {
            this.coreMesh.visibility = 1 - this.coreTransparency;
        }
        
        if (this.topShieldMesh) {
            this.topShieldMesh.visibility = 1 - this.coreTransparency;
        }
        
        if (this.bottomShieldMesh) {
            this.bottomShieldMesh.visibility = 1 - this.coreTransparency;
        }
        
        if (this.waterMaterial) {
            this.waterMaterial.alpha = 0.2 * (1 - this.coreTransparency * 0.7);
        }
    }
    
    /**
     * Initialize reactor (for compatibility with existing code)
     */
    public initializeReactor(data: Reactor3DData): void {
        // Already initialized in constructor
        // This method exists for API compatibility
        console.log('Reactor initialized with', this.coreLayout.length, 'channels');
    }
    
    /**
     * Set rod position for a specific type
     * @param rodType - Type of rod (RR, AR, LAR, USP, AZ)
     * @param position - Position from 0 (fully inserted) to 1 (fully withdrawn)
     */
    public setRodPosition(rodType: ChannelType, position: number): void {
        this.rodPositions.set(rodType, Math.max(0, Math.min(1, position)));
        this.updateRodPositions();
    }
    
    /**
     * Update all rod positions based on stored positions
     */
    private updateRodPositions(): void {
        const coreHeight = CORE_HEIGHT * SCALE;
        
        for (const channel of this.coreLayout) {
            if (channel.type === 'TK') continue; // Skip fuel channels
            
            const mesh = this.rodMeshes.get(channel.id);
            if (!mesh) continue;
            
            const position = this.rodPositions.get(channel.type) ?? 0.8;
            
            // USP rods come from BELOW the core, others from above
            if (channel.type === 'USP') {
                // USP: position=0 means fully inserted (from below), position=1 means withdrawn (below core)
                const withdrawnAmount = position * coreHeight;
                mesh.position.y = coreHeight / 2 - withdrawnAmount;
            } else {
                // Normal rods: position=0 means fully inserted, position=1 means withdrawn (above core)
                const withdrawnAmount = position * coreHeight;
                mesh.position.y = coreHeight / 2 + withdrawnAmount;
            }
        }
    }
    
    /**
     * Update visualization with new reactor state
     */
    public updateState(data: Reactor3DData, powerPercent: number): void {
        // Update rod positions from internal state
        this.updateRodPositions();
        
        // Update fuel channel colors based on power
        const intensity = powerPercent / 100;
        
        // Update core glow based on power
        if (this.glowLayer) {
            this.glowLayer.intensity = 0.3 + intensity * 0.5;
        }
        
        // Update Cherenkov light intensity
        const coreLight = this.scene.getLightByName('coreLight') as PointLight;
        if (coreLight) {
            coreLight.intensity = intensity * 0.8;
        }
        
        // Update water glow (Cherenkov effect)
        if (this.waterMaterial) {
            this.waterMaterial.emissiveColor = new Color3(
                0.05 * intensity,
                0.15 * intensity,
                0.4 * intensity
            );
        }
    }
    
    /**
     * Set camera to predefined view
     */
    public setView(view: '3d' | 'top' | 'side'): void {
        switch (view) {
            case '3d':
                this.camera.alpha = Math.PI / 4;
                this.camera.beta = Math.PI / 3;
                this.camera.radius = 20;
                break;
            case 'top':
                this.camera.alpha = 0;
                this.camera.beta = 0.01;
                this.camera.radius = 25;
                break;
            case 'side':
                this.camera.alpha = Math.PI / 2;
                this.camera.beta = Math.PI / 2;
                this.camera.radius = 20;
                break;
        }
    }
    
    /**
     * Highlight SCRAM state
     */
    public highlightScram(active: boolean): void {
        if (active) {
            // Flash all control rods
            for (const [id, mesh] of this.rodMeshes) {
                const channel = this.coreLayout.find(c => c.id === id);
                if (channel && channel.type === 'AZ') {
                    const mat = mesh.material as StandardMaterial;
                    if (mat) {
                        mat.emissiveColor = new Color3(1, 0, 0);
                    }
                }
            }
        }
    }
    
    /**
     * Get current transparency value
     */
    public getCoreTransparency(): number {
        return this.coreTransparency;
    }
    
    /**
     * Get core layout for external use
     */
    public getCoreLayout(): CoreChannel[] {
        return this.coreLayout;
    }
    
    /**
     * Dispose of all resources
     */
    public dispose(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        this.scene.dispose();
        this.engine.dispose();
    }
}
