/**
 * RBMK-1000 Reactor 2D Projection View
 * 
 * Displays a top-down 2D view of the reactor core for:
 * - Thermal hotspot visualization
 * - Power distribution analysis
 * - Control rod positions
 * - Channel status monitoring
 * 
 * Now supports all 1661 fuel channels with synchronized parameters.
 * Each channel can display its own temperature/flux values (currently synchronized).
 */

import {
    generateRBMKCoreLayout,
    loadLayoutConfig,
    isLayoutLoaded,
    CoreChannel,
    ChannelType,
    CHANNEL_COLORS,
    getChannelCounts,
} from './rbmk_core_layout';

export interface Reactor2DData {
    power_percent: number;
    avg_fuel_temp: number;
    avg_coolant_temp: number;
    avg_graphite_temp: number;
    avg_coolant_void: number;
}

/**
 * Backend fuel channel data structure
 * Matches the FuelChannel struct from reactor.rs
 */
export interface FuelChannelData {
    id: number;
    grid_x: number;
    grid_y: number;
    x: number;
    y: number;
    fuel_temp: number;
    coolant_temp: number;
    coolant_void: number;
    neutron_flux: number;
    burnup: number;
}

// Visualization modes for 2D projection
export type Visualization2DMode = 'power' | 'fuel_temp' | 'coolant_temp' | 'void_fraction' | 'channel_type';

export class Reactor2DProjection {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private coreLayout: CoreChannel[] = [];
    
    // Current visualization mode
    private mode: Visualization2DMode = 'channel_type';
    
    // Current reactor data (global averages)
    private currentData: Reactor2DData = {
        power_percent: 100,
        avg_fuel_temp: 800,
        avg_coolant_temp: 560,
        avg_graphite_temp: 600,
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
    private pulsePhase: number = 0;
    
    /**
     * Private constructor - use Reactor2DProjection.create() instead
     */
    private constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D context');
        }
        this.ctx = ctx;
        
        // Setup resize handling
        this.setupResizeHandling();
    }
    
    /**
     * Create a new Reactor2DProjection instance
     * This is an async factory method that loads the layout config before creating the projection
     */
    public static async create(canvas: HTMLCanvasElement): Promise<Reactor2DProjection> {
        // Load layout config if not already loaded
        if (!isLayoutLoaded()) {
            await loadLayoutConfig();
        }
        
        const projection = new Reactor2DProjection(canvas);
        
        // Generate core layout (now that config is loaded)
        projection.coreLayout = generateRBMKCoreLayout();
        console.log('[2D Projection] Core layout loaded:', getChannelCounts(projection.coreLayout));
        
        // Initial render
        projection.render();
        
        // Start animation loop
        projection.startAnimation();
        
        return projection;
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
        const padding = 40;
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
            this.pulsePhase += 0.02;
            if (this.pulsePhase > Math.PI * 2) {
                this.pulsePhase -= Math.PI * 2;
            }
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
    public setMode(mode: Visualization2DMode): void {
        this.mode = mode;
        this.render();
    }
    
    /**
     * Update reactor data
     */
    public updateData(data: Reactor2DData): void {
        this.currentData = data;
        this.render();
    }
    
    /**
     * Update fuel channel data from backend
     * This receives the 1661 fuel channels with their individual parameters
     * (currently synchronized - all have same values)
     */
    public updateFuelChannels(channels: FuelChannelData[]): void {
        this.fuelChannelData.clear();
        
        for (const channel of channels) {
            // Key by grid position for fast lookup
            const key = `${channel.grid_x},${channel.grid_y}`;
            this.fuelChannelData.set(key, channel);
        }
        
        this.channelDataLoaded = channels.length > 0;
        console.log(`[2D Projection] Updated ${channels.length} fuel channels`);
        this.render();
    }
    
    /**
     * Get fuel channel data for a specific grid position
     */
    private getFuelChannelData(gridX: number, gridY: number): FuelChannelData | undefined {
        const key = `${gridX},${gridY}`;
        return this.fuelChannelData.get(key);
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
        
        // Draw core boundary
        this.drawCoreBoundary();
        
        // Draw grid (optional, for reference)
        this.drawGrid();
        
        // Draw channels
        this.drawChannels();
        
        // Draw center point (current single-point representation)
        this.drawCenterPoint();
        
        // Draw legend
        this.drawLegend();
        
        // Draw info panel
        this.drawInfoPanel();
    }
    
    private drawCoreBoundary(): void {
        const ctx = this.ctx;
        const radius = this.CORE_RADIUS * this.scale;
        
        // Outer glow
        const gradient = ctx.createRadialGradient(
            this.offsetX, this.offsetY, radius * 0.9,
            this.offsetX, this.offsetY, radius * 1.1
        );
        gradient.addColorStop(0, 'rgba(233, 69, 96, 0.1)');
        gradient.addColorStop(1, 'rgba(233, 69, 96, 0)');
        
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, radius * 1.1, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Core boundary circle
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(233, 69, 96, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Inner circle (active zone)
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, radius * 0.95, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(233, 69, 96, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    
    private drawGrid(): void {
        const ctx = this.ctx;
        const gridSize = this.GRID_SPACING * this.scale;
        const radius = this.CORE_RADIUS * this.scale;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 0.5;
        
        // Draw grid lines
        const gridCount = Math.ceil(radius / gridSize);
        for (let i = -gridCount; i <= gridCount; i++) {
            const pos = i * gridSize;
            
            // Vertical lines
            ctx.beginPath();
            ctx.moveTo(this.offsetX + pos, this.offsetY - radius);
            ctx.lineTo(this.offsetX + pos, this.offsetY + radius);
            ctx.stroke();
            
            // Horizontal lines
            ctx.beginPath();
            ctx.moveTo(this.offsetX - radius, this.offsetY + pos);
            ctx.lineTo(this.offsetX + radius, this.offsetY + pos);
            ctx.stroke();
        }
    }
    
    private drawChannels(): void {
        const ctx = this.ctx;
        const channelRadius = this.GRID_SPACING * this.scale * 0.35;
        
        for (const channel of this.coreLayout) {
            const x = this.offsetX + channel.x * this.scale;
            const y = this.offsetY + channel.y * this.scale;
            
            // Get color based on mode and channel type
            const color = this.getChannelColor(channel);
            
            // Draw channel
            ctx.beginPath();
            ctx.arc(x, y, channelRadius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            
            // Add subtle border for control rods
            if (channel.type !== 'TK') {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }
    
    private getChannelColor(channel: CoreChannel): string {
        const colors = CHANNEL_COLORS[channel.type];
        
        if (this.mode === 'channel_type') {
            // Color by channel type
            return `rgba(${colors.r * 255}, ${colors.g * 255}, ${colors.b * 255}, 0.8)`;
        }
        
        // For TK (fuel) channels, use per-channel data if available
        if (channel.type === 'TK' && this.channelDataLoaded) {
            const channelData = this.getFuelChannelData(channel.gridX, channel.gridY);
            
            if (channelData) {
                switch (this.mode) {
                    case 'power':
                        // Neutron flux normalized (assuming max ~1e14)
                        const fluxNorm = Math.min(1, channelData.neutron_flux / 1e14);
                        return this.getHeatmapColor(fluxNorm);
                    case 'fuel_temp':
                        // Fuel temperature: 300K (cold) to 1300K (hot)
                        const fuelTempNorm = (channelData.fuel_temp - 300) / 1000;
                        return this.getHeatmapColor(fuelTempNorm);
                    case 'coolant_temp':
                        // Coolant temperature: 300K to 600K
                        const coolantTempNorm = (channelData.coolant_temp - 300) / 300;
                        return this.getHeatmapColor(coolantTempNorm);
                    case 'void_fraction':
                        // Void fraction: 0% to 100%
                        const voidNorm = channelData.coolant_void / 100;
                        return this.getHeatmapColor(voidNorm);
                }
            }
        }
        
        // Fallback: use global averages for non-TK channels or when no data
        const intensity = this.currentData.power_percent / 100;
        
        switch (this.mode) {
            case 'power':
                return this.getHeatmapColor(intensity);
            case 'fuel_temp':
                return this.getHeatmapColor((this.currentData.avg_fuel_temp - 300) / 1000);
            case 'coolant_temp':
                return this.getHeatmapColor((this.currentData.avg_coolant_temp - 300) / 300);
            case 'void_fraction':
                return this.getHeatmapColor(this.currentData.avg_coolant_void / 100);
            default:
                return `rgba(${colors.r * 255}, ${colors.g * 255}, ${colors.b * 255}, 0.8)`;
        }
    }
    
    private getHeatmapColor(value: number): string {
        // Clamp value between 0 and 1
        value = Math.max(0, Math.min(1, value));
        
        // Blue -> Cyan -> Green -> Yellow -> Red
        let r: number, g: number, b: number;
        
        if (value < 0.25) {
            // Blue to Cyan
            const t = value / 0.25;
            r = 0;
            g = t * 255;
            b = 255;
        } else if (value < 0.5) {
            // Cyan to Green
            const t = (value - 0.25) / 0.25;
            r = 0;
            g = 255;
            b = (1 - t) * 255;
        } else if (value < 0.75) {
            // Green to Yellow
            const t = (value - 0.5) / 0.25;
            r = t * 255;
            g = 255;
            b = 0;
        } else {
            // Yellow to Red
            const t = (value - 0.75) / 0.25;
            r = 255;
            g = (1 - t) * 255;
            b = 0;
        }
        
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.9)`;
    }
    
    /**
     * Draw center point - shown only when channel data is not loaded
     * This is a fallback indicator until per-channel data is available
     */
    private drawCenterPoint(): void {
        // Only show center point when no channel data is loaded
        if (this.channelDataLoaded) {
            return;
        }
        
        const ctx = this.ctx;
        const pulse = Math.sin(this.pulsePhase) * 0.3 + 0.7;
        
        // Pulsing glow effect based on power
        const glowRadius = 50 * this.scale * (this.currentData.power_percent / 100);
        const gradient = ctx.createRadialGradient(
            this.offsetX, this.offsetY, 0,
            this.offsetX, this.offsetY, glowRadius
        );
        
        const intensity = this.currentData.power_percent / 100;
        gradient.addColorStop(0, `rgba(255, ${100 - intensity * 100}, 50, ${0.8 * pulse})`);
        gradient.addColorStop(0.5, `rgba(255, ${150 - intensity * 100}, 50, ${0.3 * pulse})`);
        gradient.addColorStop(1, 'rgba(255, 100, 50, 0)');
        
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Center marker
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#e94560';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Crosshair
        ctx.strokeStyle = 'rgba(233, 69, 96, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.offsetX - 20, this.offsetY);
        ctx.lineTo(this.offsetX + 20, this.offsetY);
        ctx.moveTo(this.offsetX, this.offsetY - 20);
        ctx.lineTo(this.offsetX, this.offsetY + 20);
        ctx.stroke();
    }
    
    private drawLegend(): void {
        const ctx = this.ctx;
        const legendX = 15;
        let legendY = 20;
        const lineHeight = 18;
        
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#e94560';
        ctx.fillText('Channel Types (OPB-82)', legendX, legendY);
        legendY += lineHeight + 5;
        
        const types: { type: ChannelType; label: string; count: number }[] = [
            { type: 'TK', label: 'TK - Fuel Channels', count: 1661 },
            { type: 'AZ', label: 'AZ - Emergency Rods', count: 33 },
            { type: 'RR', label: 'RR - Manual Control', count: 146 },
            { type: 'AR', label: 'AR - Automatic', count: 8 },
            { type: 'LAR', label: 'LAR - Local Auto', count: 12 },
            { type: 'USP', label: 'USP - Shortened', count: 24 },
        ];
        
        for (const item of types) {
            const color = CHANNEL_COLORS[item.type];
            
            // Color box
            ctx.fillStyle = `rgb(${color.r * 255}, ${color.g * 255}, ${color.b * 255})`;
            ctx.fillRect(legendX, legendY - 10, 12, 12);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.strokeRect(legendX, legendY - 10, 12, 12);
            
            // Label
            ctx.fillStyle = '#aaa';
            ctx.fillText(`${item.label} (${item.count})`, legendX + 18, legendY);
            
            legendY += lineHeight;
        }
    }
    
    private drawInfoPanel(): void {
        const ctx = this.ctx;
        const panelWidth = 180;
        const panelHeight = 135;
        const panelX = this.canvas.width - panelWidth - 15;
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
        ctx.fillText('Reactor Status', panelX + 10, panelY + 20);
        
        // Data
        ctx.font = '11px "Consolas", monospace';
        const data = [
            { label: 'Power:', value: `${this.currentData.power_percent.toFixed(1)}%` },
            { label: 'Fuel Temp:', value: `${this.currentData.avg_fuel_temp.toFixed(0)} K` },
            { label: 'Coolant:', value: `${this.currentData.avg_coolant_temp.toFixed(0)} K` },
            { label: 'Graphite:', value: `${this.currentData.avg_graphite_temp.toFixed(0)} K` },
            { label: 'Void:', value: `${this.currentData.avg_coolant_void.toFixed(1)}%` },
        ];
        
        let y = panelY + 40;
        for (const item of data) {
            ctx.fillStyle = '#888';
            ctx.fillText(item.label, panelX + 10, y);
            ctx.fillStyle = '#4ade80';
            ctx.fillText(item.value, panelX + 90, y);
            y += 16;
        }
        
        // Channel data status
        ctx.font = '10px "Segoe UI", sans-serif';
        if (this.channelDataLoaded) {
            ctx.fillStyle = '#4ade80';
            ctx.fillText(`✓ ${this.fuelChannelData.size} channels synced`, panelX + 10, panelY + panelHeight - 8);
        } else {
            ctx.fillStyle = '#fbbf24';
            ctx.fillText('⚠ Waiting for channel data', panelX + 10, panelY + panelHeight - 8);
        }
    }
    
    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopAnimation();
    }
}
