/**
 * RBMK-1000 Reactor Heatmap View
 * 
 * Displays a 2D heatmap of the reactor core with smooth thermal gradients.
 * Unlike the 2D projection which shows individual channels, this view
 * interpolates values between channels to create a continuous heatmap.
 * 
 * Features:
 * - Smooth thermal gradient visualization
 * - Multiple visualization modes (power, temperature, xenon, etc.)
 * - Real-time updates from per-channel data
 * - Color scale legend
 */

import {
    generateRBMKCoreLayout,
    loadLayoutConfig,
    isLayoutLoaded,
    CoreChannel,
    ChannelType,
} from './rbmk_core_layout';

// Re-export FuelChannelData from reactor_2d for consistency
export type { FuelChannelData } from './reactor_2d';
import type { FuelChannelData } from './reactor_2d';

export interface HeatmapData {
    power_percent: number;
    avg_fuel_temp: number;
    avg_coolant_temp: number;
    avg_graphite_temp: number;
    avg_coolant_void: number;
}

// Visualization modes for heatmap
export type HeatmapMode = 'power' | 'fuel_temp' | 'coolant_temp' | 'graphite_temp' | 'void_fraction' | 'xenon' | 'local_reactivity';

// Color scale presets
interface ColorStop {
    value: number;  // 0.0 to 1.0
    r: number;
    g: number;
    b: number;
}

const THERMAL_SCALE: ColorStop[] = [
    { value: 0.0, r: 0, g: 0, b: 128 },      // Deep blue (cold)
    { value: 0.2, r: 0, g: 128, b: 255 },    // Light blue
    { value: 0.4, r: 0, g: 255, b: 128 },    // Cyan-green
    { value: 0.5, r: 0, g: 255, b: 0 },      // Green
    { value: 0.6, r: 128, g: 255, b: 0 },    // Yellow-green
    { value: 0.7, r: 255, g: 255, b: 0 },    // Yellow
    { value: 0.85, r: 255, g: 128, b: 0 },   // Orange
    { value: 1.0, r: 255, g: 0, b: 0 },      // Red (hot)
];

const XENON_SCALE: ColorStop[] = [
    { value: 0.0, r: 20, g: 20, b: 40 },     // Dark (no xenon)
    { value: 0.3, r: 80, g: 0, b: 120 },     // Purple
    { value: 0.6, r: 160, g: 0, b: 200 },    // Magenta
    { value: 0.8, r: 255, g: 100, b: 255 },  // Pink
    { value: 1.0, r: 255, g: 255, b: 255 },  // White (max xenon)
];

const REACTIVITY_SCALE: ColorStop[] = [
    { value: 0.0, r: 0, g: 100, b: 255 },    // Blue (negative)
    { value: 0.4, r: 0, g: 200, b: 200 },    // Cyan
    { value: 0.5, r: 50, g: 50, b: 50 },     // Gray (neutral)
    { value: 0.6, r: 200, g: 200, b: 0 },    // Yellow
    { value: 1.0, r: 255, g: 50, b: 0 },     // Red (positive)
];

export class ReactorHeatmap {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private coreLayout: CoreChannel[] = [];
    
    // Heatmap data grid (interpolated)
    private heatmapGrid: number[][] = [];
    private gridResolution: number = 100;  // Grid cells per dimension
    
    // Current visualization mode
    private mode: HeatmapMode = 'fuel_temp';
    
    // Current reactor data (global averages)
    private currentData: HeatmapData = {
        power_percent: 0,
        avg_fuel_temp: 300,
        avg_coolant_temp: 300,
        avg_graphite_temp: 300,
        avg_coolant_void: 0,
    };
    
    // Per-channel data from backend (1661 fuel channels)
    private fuelChannelData: Map<string, FuelChannelData> = new Map();
    private channelDataLoaded: boolean = false;
    
    // Scale and positioning
    private scale: number = 1;
    private offsetX: number = 0;
    private offsetY: number = 0;
    
    // Core dimensions (cm)
    private readonly CORE_RADIUS = 593;
    private readonly GRID_SPACING = 25;
    
    // Animation
    private animationId: number | null = null;
    
    // Value ranges for normalization
    private valueRanges: Record<HeatmapMode, { min: number; max: number }> = {
        power: { min: 0, max: 5 },           // MW per channel
        fuel_temp: { min: 300, max: 1500 },  // K
        coolant_temp: { min: 300, max: 600 }, // K
        graphite_temp: { min: 300, max: 800 }, // K
        void_fraction: { min: 0, max: 100 }, // %
        xenon: { min: 0, max: 5e15 },        // atoms/cm³
        local_reactivity: { min: -0.05, max: 0.05 }, // Δk/k
    };
    
    /**
     * Private constructor - use ReactorHeatmap.create() instead
     */
    private constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D context');
        }
        this.ctx = ctx;
        
        // Initialize heatmap grid
        this.initializeGrid();
        
        // Setup resize handling
        this.setupResizeHandling();
    }
    
    /**
     * Create a new ReactorHeatmap instance
     */
    public static async create(canvas: HTMLCanvasElement): Promise<ReactorHeatmap> {
        // Load layout config if not already loaded
        if (!isLayoutLoaded()) {
            await loadLayoutConfig();
        }
        
        const heatmap = new ReactorHeatmap(canvas);
        
        // Generate core layout (now that config is loaded)
        heatmap.coreLayout = generateRBMKCoreLayout();
        console.log('[Heatmap] Core layout loaded:', heatmap.coreLayout.length, 'channels');
        
        // Initial render
        heatmap.render();
        
        // Start animation loop
        heatmap.startAnimation();
        
        return heatmap;
    }
    
    private initializeGrid(): void {
        this.heatmapGrid = [];
        for (let i = 0; i < this.gridResolution; i++) {
            this.heatmapGrid[i] = new Array(this.gridResolution).fill(0);
        }
    }
    
    private setupResizeHandling(): void {
        const resizeObserver = new ResizeObserver(() => {
            this.handleResize();
        });
        
        const container = this.canvas.parentElement;
        if (container) {
            resizeObserver.observe(container);
        }
        
        window.addEventListener('resize', () => this.handleResize());
        
        // Initial resize
        setTimeout(() => this.handleResize(), 100);
    }
    
    private handleResize(): void {
        const container = this.canvas.parentElement;
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                this.canvas.width = rect.width;
                this.canvas.height = rect.height;
                this.calculateScale();
                this.render();
            }
        }
    }
    
    private calculateScale(): void {
        const padding = 60;
        const availableWidth = this.canvas.width - padding * 2;
        const availableHeight = this.canvas.height - padding * 2;
        
        // Scale to fit core diameter
        const coreDiameter = this.CORE_RADIUS * 2;
        this.scale = Math.min(availableWidth, availableHeight) / coreDiameter;
        
        // Center the core
        this.offsetX = this.canvas.width / 2;
        this.offsetY = this.canvas.height / 2;
    }
    
    private startAnimation(): void {
        const animate = () => {
            this.render();
            this.animationId = requestAnimationFrame(animate);
        };
        this.animationId = requestAnimationFrame(animate);
    }
    
    public stopAnimation(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    /**
     * Set visualization mode
     */
    public setMode(mode: HeatmapMode): void {
        this.mode = mode;
        this.updateHeatmapGrid();
        this.render();
    }
    
    /**
     * Update reactor data
     */
    public updateData(data: HeatmapData): void {
        this.currentData = data;
        this.updateHeatmapGrid();
        this.render();
    }
    
    /**
     * Update fuel channel data from backend
     */
    public updateFuelChannels(channels: FuelChannelData[]): void {
        this.fuelChannelData.clear();
        
        for (const channel of channels) {
            const key = `${channel.grid_x},${channel.grid_y}`;
            this.fuelChannelData.set(key, channel);
        }
        
        this.channelDataLoaded = channels.length > 0;
        this.updateHeatmapGrid();
    }
    
    /**
     * Get fuel channel data for a specific grid position
     */
    private getFuelChannelData(gridX: number, gridY: number): FuelChannelData | undefined {
        const key = `${gridX},${gridY}`;
        return this.fuelChannelData.get(key);
    }
    
    /**
     * Get value for a channel based on current mode
     */
    private getChannelValue(channel: FuelChannelData): number {
        switch (this.mode) {
            case 'power':
                return channel.local_power;
            case 'fuel_temp':
                return channel.fuel_temp;
            case 'coolant_temp':
                return channel.coolant_temp;
            case 'graphite_temp':
                return channel.graphite_temp;
            case 'void_fraction':
                return channel.coolant_void;
            case 'xenon':
                return channel.xenon_135;
            case 'local_reactivity':
                return channel.local_reactivity;
            default:
                return 0;
        }
    }
    
    /**
     * Normalize value to 0-1 range based on mode
     */
    private normalizeValue(value: number): number {
        const range = this.valueRanges[this.mode];
        const normalized = (value - range.min) / (range.max - range.min);
        return Math.max(0, Math.min(1, normalized));
    }
    
    /**
     * Update the heatmap grid by interpolating channel values
     */
    private updateHeatmapGrid(): void {
        if (!this.channelDataLoaded) {
            // Use global average for all cells
            const avgValue = this.getGlobalAverageValue();
            const normalized = this.normalizeValue(avgValue);
            for (let i = 0; i < this.gridResolution; i++) {
                for (let j = 0; j < this.gridResolution; j++) {
                    this.heatmapGrid[i][j] = normalized;
                }
            }
            return;
        }
        
        // Build channel value map for interpolation
        const channelValues: { x: number; y: number; value: number }[] = [];
        
        for (const channel of this.coreLayout) {
            if (channel.type === 'TK') {
                const data = this.getFuelChannelData(channel.gridX, channel.gridY);
                if (data) {
                    channelValues.push({
                        x: channel.x,
                        y: channel.y,
                        value: this.getChannelValue(data),
                    });
                }
            }
        }
        
        // Interpolate values to grid using inverse distance weighting
        // with increased smoothing for better visualization
        const gridStep = (this.CORE_RADIUS * 2) / this.gridResolution;
        const startX = -this.CORE_RADIUS;
        const startY = -this.CORE_RADIUS;
        
        // Use lower power for smoother interpolation (1.5 instead of 2)
        // and limit the number of nearest neighbors for performance
        const power = 1.5; // Lower power = smoother gradients
        const maxNeighbors = 20; // Consider more neighbors for smoother result
        const maxDistance = 200; // Maximum distance to consider (cm) - increased for smoother gradients
        
        for (let i = 0; i < this.gridResolution; i++) {
            for (let j = 0; j < this.gridResolution; j++) {
                const x = startX + (i + 0.5) * gridStep;
                const y = startY + (j + 0.5) * gridStep;
                
                // Check if point is inside core
                const distFromCenter = Math.sqrt(x * x + y * y);
                if (distFromCenter > this.CORE_RADIUS) {
                    this.heatmapGrid[i][j] = -1; // Outside core
                    continue;
                }
                
                // Find nearest channels and calculate distances
                const channelDistances: { value: number; dist: number }[] = [];
                
                for (const cv of channelValues) {
                    const dx = x - cv.x;
                    const dy = y - cv.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist < maxDistance) {
                        channelDistances.push({ value: cv.value, dist });
                    }
                }
                
                // Sort by distance and take nearest neighbors
                channelDistances.sort((a, b) => a.dist - b.dist);
                const nearest = channelDistances.slice(0, maxNeighbors);
                
                // Inverse distance weighting interpolation
                let weightedSum = 0;
                let weightSum = 0;
                
                for (const { value, dist } of nearest) {
                    if (dist < 1) {
                        // Very close to a channel - use its value directly
                        weightedSum = value;
                        weightSum = 1;
                        break;
                    }
                    
                    // Use Gaussian-like weighting for smoother results
                    // weight = exp(-dist² / (2 * sigma²)) where sigma ≈ 80cm
                    // Increased sigma for more realistic smooth neutron diffusion
                    const sigma = 80;
                    const weight = Math.exp(-(dist * dist) / (2 * sigma * sigma));
                    weightedSum += weight * value;
                    weightSum += weight;
                }
                
                const interpolatedValue = weightSum > 0 ? weightedSum / weightSum : 0;
                this.heatmapGrid[i][j] = this.normalizeValue(interpolatedValue);
            }
        }
    }
    
    /**
     * Get global average value based on current mode
     */
    private getGlobalAverageValue(): number {
        switch (this.mode) {
            case 'power':
                return this.currentData.power_percent * 32 / 100; // ~3200 MW / 1661 channels
            case 'fuel_temp':
                return this.currentData.avg_fuel_temp;
            case 'coolant_temp':
                return this.currentData.avg_coolant_temp;
            case 'graphite_temp':
                return this.currentData.avg_graphite_temp;
            case 'void_fraction':
                return this.currentData.avg_coolant_void;
            case 'xenon':
                return 0; // No global xenon average in current data
            case 'local_reactivity':
                return 0;
            default:
                return 0;
        }
    }
    
    /**
     * Get color from color scale
     */
    private getColorFromScale(value: number, scale: ColorStop[]): { r: number; g: number; b: number } {
        value = Math.max(0, Math.min(1, value));
        
        // Find the two stops to interpolate between
        let lower = scale[0];
        let upper = scale[scale.length - 1];
        
        for (let i = 0; i < scale.length - 1; i++) {
            if (value >= scale[i].value && value <= scale[i + 1].value) {
                lower = scale[i];
                upper = scale[i + 1];
                break;
            }
        }
        
        // Interpolate between stops
        const t = (value - lower.value) / (upper.value - lower.value);
        return {
            r: Math.round(lower.r + t * (upper.r - lower.r)),
            g: Math.round(lower.g + t * (upper.g - lower.g)),
            b: Math.round(lower.b + t * (upper.b - lower.b)),
        };
    }
    
    /**
     * Get color for current mode
     */
    private getHeatmapColor(value: number): { r: number; g: number; b: number } {
        if (value < 0) {
            // Outside core
            return { r: 10, g: 10, b: 20 };
        }
        
        switch (this.mode) {
            case 'xenon':
                return this.getColorFromScale(value, XENON_SCALE);
            case 'local_reactivity':
                return this.getColorFromScale(value, REACTIVITY_SCALE);
            default:
                return this.getColorFromScale(value, THERMAL_SCALE);
        }
    }
    
    /**
     * Main render function
     */
    public render(): void {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#0a0a15';
        ctx.fillRect(0, 0, width, height);
        
        // Draw heatmap
        this.drawHeatmap();
        
        // Draw core boundary
        this.drawCoreBoundary();
        
        // Draw color scale legend
        this.drawColorScale();
        
        // Draw info panel
        this.drawInfoPanel();
        
        // Draw mode label
        this.drawModeLabel();
    }
    
    private drawHeatmap(): void {
        const ctx = this.ctx;
        const gridStep = (this.CORE_RADIUS * 2) / this.gridResolution;
        const cellSize = gridStep * this.scale;
        
        // Create image data for faster rendering
        const imageData = ctx.createImageData(this.canvas.width, this.canvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < this.gridResolution; i++) {
            for (let j = 0; j < this.gridResolution; j++) {
                const value = this.heatmapGrid[i][j];
                const color = this.getHeatmapColor(value);
                
                // Calculate screen position
                const gridX = -this.CORE_RADIUS + (i + 0.5) * gridStep;
                const gridY = -this.CORE_RADIUS + (j + 0.5) * gridStep;
                const screenX = this.offsetX + gridX * this.scale;
                const screenY = this.offsetY + gridY * this.scale;
                
                // Draw cell
                const startX = Math.floor(screenX - cellSize / 2);
                const startY = Math.floor(screenY - cellSize / 2);
                const endX = Math.ceil(screenX + cellSize / 2);
                const endY = Math.ceil(screenY + cellSize / 2);
                
                for (let px = startX; px < endX; px++) {
                    for (let py = startY; py < endY; py++) {
                        if (px >= 0 && px < this.canvas.width && py >= 0 && py < this.canvas.height) {
                            const idx = (py * this.canvas.width + px) * 4;
                            data[idx] = color.r;
                            data[idx + 1] = color.g;
                            data[idx + 2] = color.b;
                            data[idx + 3] = value >= 0 ? 255 : 0; // Transparent outside core
                        }
                    }
                }
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
    }
    
    private drawCoreBoundary(): void {
        const ctx = this.ctx;
        const radius = this.CORE_RADIUS * this.scale;
        
        // Core boundary circle
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Inner circle (active zone)
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, radius * 0.95, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    
    private drawColorScale(): void {
        const ctx = this.ctx;
        const scaleWidth = 30;
        const scaleHeight = 200;
        const scaleX = this.canvas.width - 60;
        const scaleY = (this.canvas.height - scaleHeight) / 2;
        
        // Get appropriate color scale
        let scale: ColorStop[];
        switch (this.mode) {
            case 'xenon':
                scale = XENON_SCALE;
                break;
            case 'local_reactivity':
                scale = REACTIVITY_SCALE;
                break;
            default:
                scale = THERMAL_SCALE;
        }
        
        // Draw gradient
        const gradient = ctx.createLinearGradient(scaleX, scaleY + scaleHeight, scaleX, scaleY);
        for (const stop of scale) {
            gradient.addColorStop(stop.value, `rgb(${stop.r}, ${stop.g}, ${stop.b})`);
        }
        
        ctx.fillStyle = gradient;
        ctx.fillRect(scaleX, scaleY, scaleWidth, scaleHeight);
        
        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(scaleX, scaleY, scaleWidth, scaleHeight);
        
        // Labels
        ctx.font = '11px "Consolas", monospace';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        
        const range = this.valueRanges[this.mode];
        const formatValue = (v: number): string => {
            if (Math.abs(v) >= 1e10) return v.toExponential(1);
            if (Math.abs(v) >= 1000) return v.toFixed(0);
            if (Math.abs(v) >= 1) return v.toFixed(1);
            return v.toFixed(3);
        };
        
        ctx.fillText(formatValue(range.max), scaleX + scaleWidth + 5, scaleY + 10);
        ctx.fillText(formatValue((range.max + range.min) / 2), scaleX + scaleWidth + 5, scaleY + scaleHeight / 2 + 4);
        ctx.fillText(formatValue(range.min), scaleX + scaleWidth + 5, scaleY + scaleHeight);
        
        // Unit label
        const units: Record<HeatmapMode, string> = {
            power: 'MW',
            fuel_temp: 'K',
            coolant_temp: 'K',
            graphite_temp: 'K',
            void_fraction: '%',
            xenon: 'at/cm³',
            local_reactivity: 'Δk/k',
        };
        
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillStyle = '#aaa';
        ctx.fillText(units[this.mode], scaleX + scaleWidth + 5, scaleY + scaleHeight + 15);
    }
    
    private drawInfoPanel(): void {
        const ctx = this.ctx;
        const panelWidth = 180;
        const panelHeight = 100;
        const panelX = 15;
        const panelY = 15;
        
        // Panel background
        ctx.fillStyle = 'rgba(22, 33, 62, 0.9)';
        ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
        ctx.strokeStyle = '#0f3460';
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
        
        // Title
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#e94560';
        ctx.fillText('Heatmap Status', panelX + 10, panelY + 20);
        
        // Data
        ctx.font = '11px "Consolas", monospace';
        const data = [
            { label: 'Power:', value: `${this.currentData.power_percent.toFixed(1)}%` },
            { label: 'Channels:', value: this.channelDataLoaded ? `${this.fuelChannelData.size}` : 'Loading...' },
            { label: 'Grid:', value: `${this.gridResolution}×${this.gridResolution}` },
        ];
        
        let y = panelY + 40;
        for (const item of data) {
            ctx.fillStyle = '#888';
            ctx.fillText(item.label, panelX + 10, y);
            ctx.fillStyle = '#4ade80';
            ctx.fillText(item.value, panelX + 90, y);
            y += 18;
        }
    }
    
    private drawModeLabel(): void {
        const ctx = this.ctx;
        
        const modeLabels: Record<HeatmapMode, string> = {
            power: '🔥 Power Distribution',
            fuel_temp: '🌡️ Fuel Temperature',
            coolant_temp: '💧 Coolant Temperature',
            graphite_temp: '🧱 Graphite Temperature',
            void_fraction: '💨 Void Fraction',
            xenon: '☢️ Xenon-135 Concentration',
            local_reactivity: '⚛️ Local Reactivity',
        };
        
        ctx.font = 'bold 16px "Segoe UI", sans-serif';
        ctx.fillStyle = '#e94560';
        ctx.textAlign = 'center';
        ctx.fillText(modeLabels[this.mode], this.canvas.width / 2, 30);
        ctx.textAlign = 'left';
    }
    
    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopAnimation();
    }
}
