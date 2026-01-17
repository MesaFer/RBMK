/**
 * RBMK-1000 CYS (СУЗ) Control Panel
 * 
 * Provides comprehensive control rod management:
 * - Group Control: Control all rods of a type simultaneously (RR, AR, LAR, USP, AZ)
 * - Individual Control: Select and control specific rods on the core layout
 * 
 * Control rod types:
 * - RR (146): Manual control rods - main reactivity control
 * - AR (8): Automatic control rods - power regulation
 * - LAR (12): Local automatic control rods - local power regulation
 * - USP (24): Shortened absorber rods - bottom insertion
 * - AZ (33): Emergency protection rods - SCRAM
 */

import { invoke } from '@tauri-apps/api/core';
import {
    generateRBMKCoreLayout,
    loadLayoutConfig,
    isLayoutLoaded,
    CoreChannel,
    ChannelType,
    CHANNEL_COLORS,
} from './rbmk_core_layout';

// Control rod data from backend
export interface ControlRodData {
    id: number;
    grid_x: number;
    grid_y: number;
    x: number;
    y: number;
    position: number;  // 0.0 = inserted, 1.0 = withdrawn
    rod_type: string;  // 'Manual', 'Automatic', 'Shortened', 'Emergency' (from Rust enum)
    channel_type: string;  // 'RR', 'AR', 'LAR', 'USP', 'AZ' (original config type)
    worth: number;
}

// Control mode
export type ControlMode = 'group' | 'individual';

// Rod group info
interface RodGroup {
    type: ChannelType;
    name: string;
    count: number;
    color: string;
    position: number;  // Average position
    autoControlled?: boolean;
}

export class CYSControlPanel {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private coreLayout: CoreChannel[] = [];
    
    // Control mode
    private mode: ControlMode = 'group';
    
    // Rod data
    private rodGroups: Map<ChannelType, RodGroup> = new Map();
    private controlRods: Map<string, ControlRodData> = new Map();  // key: "gridX,gridY"
    
    // Individual control state
    private selectedRod: CoreChannel | null = null;
    private hoveredRod: CoreChannel | null = null;
    
    // Scale and positioning
    private scale: number = 1;
    private offsetX: number = 0;
    private offsetY: number = 0;
    
    // Core dimensions (cm)
    private readonly CORE_RADIUS = 593;
    private readonly GRID_SPACING = 25;
    
    // Animation
    private animationId: number | null = null;
    
    // Callbacks
    private onRodPositionChange?: (rodType: string, position: number, gridX?: number, gridY?: number) => void;
    private onRodSelected?: (channel: CoreChannel, rodData?: ControlRodData) => void;
    
    /**
     * Private constructor - use CYSControlPanel.create() instead
     */
    private constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D context');
        }
        this.ctx = ctx;
        
        // Initialize rod groups
        this.initializeRodGroups();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Setup resize handling
        this.setupResizeHandling();
    }
    
    /**
     * Create a new CYSControlPanel instance
     */
    public static async create(canvas: HTMLCanvasElement): Promise<CYSControlPanel> {
        // Load layout config if not already loaded
        if (!isLayoutLoaded()) {
            await loadLayoutConfig();
        }
        
        const panel = new CYSControlPanel(canvas);
        
        // Generate core layout (now that config is loaded)
        panel.coreLayout = generateRBMKCoreLayout();
        console.log('[CYS] Core layout loaded:', panel.coreLayout.length, 'channels');
        
        // Count rods by type
        panel.updateRodCounts();
        
        // Initial render
        panel.render();
        
        // Start animation loop
        panel.startAnimation();
        
        return panel;
    }
    
    private initializeRodGroups(): void {
        this.rodGroups.set('RR', {
            type: 'RR',
            name: 'Manual Rods (RR)',
            count: 0,
            color: '#ffffff',
            position: 0,
        });
        this.rodGroups.set('AR', {
            type: 'AR',
            name: 'Automatic Rods (AR)',
            count: 0,
            color: '#0066ff',
            position: 0,
            autoControlled: true,
        });
        this.rodGroups.set('LAR', {
            type: 'LAR',
            name: 'Local Automatic (LAR)',
            count: 0,
            color: '#00b3b3',
            position: 0,
            autoControlled: true,
        });
        this.rodGroups.set('USP', {
            type: 'USP',
            name: 'Shortened Absorbers (USP)',
            count: 0,
            color: '#ffd900',
            position: 0,
        });
        this.rodGroups.set('AZ', {
            type: 'AZ',
            name: 'Emergency Rods (AZ)',
            count: 0,
            color: '#ff0000',
            position: 0,
        });
    }
    
    private updateRodCounts(): void {
        // Reset counts
        for (const group of this.rodGroups.values()) {
            group.count = 0;
        }
        
        // Count from layout
        for (const channel of this.coreLayout) {
            const group = this.rodGroups.get(channel.type);
            if (group) {
                group.count++;
            }
        }
        
        console.log('[CYS] Rod counts:', 
            Array.from(this.rodGroups.entries())
                .filter(([_, g]) => g.count > 0)
                .map(([t, g]) => `${t}: ${g.count}`)
                .join(', ')
        );
    }
    
    private setupEventHandlers(): void {
        // Mouse move for hover
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        
        // Click for selection
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        
        // Mouse leave
        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredRod = null;
        });
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
     * Set control mode
     */
    public setMode(mode: ControlMode): void {
        this.mode = mode;
        if (mode === 'group') {
            this.selectedRod = null;
        }
        this.render();
    }
    
    /**
     * Get current control mode
     */
    public getMode(): ControlMode {
        return this.mode;
    }
    
    /**
     * Update rod positions from backend data
     */
    public updateRodPositions(rods: ControlRodData[]): void {
        this.controlRods.clear();
        
        // Group positions for averaging - use channel_type (RR, AR, LAR, etc.)
        const groupPositions: Map<string, number[]> = new Map();
        
        for (const rod of rods) {
            const key = `${rod.grid_x},${rod.grid_y}`;
            this.controlRods.set(key, rod);
            
            // Use channel_type for grouping (RR, AR, LAR, USP, AZ)
            // Fall back to rod_type mapping if channel_type not available
            const channelType = rod.channel_type || this.mapRodTypeToChannelType(rod.rod_type);
            
            // Accumulate for group average
            if (!groupPositions.has(channelType)) {
                groupPositions.set(channelType, []);
            }
            groupPositions.get(channelType)!.push(rod.position);
        }
        
        // Update group averages
        for (const [type, positions] of groupPositions) {
            const group = this.rodGroups.get(type as ChannelType);
            if (group && positions.length > 0) {
                group.position = positions.reduce((a, b) => a + b, 0) / positions.length;
            }
        }
    }
    
    /**
     * Set callback for rod position changes
     */
    public setOnRodPositionChange(callback: (rodType: string, position: number, gridX?: number, gridY?: number) => void): void {
        this.onRodPositionChange = callback;
    }
    
    /**
     * Set callback for rod selection
     */
    public setOnRodSelected(callback: (channel: CoreChannel, rodData?: ControlRodData) => void): void {
        this.onRodSelected = callback;
    }
    
    /**
     * Map rod_type (from Rust enum) to channel_type (RR, AR, LAR, USP, AZ)
     */
    private mapRodTypeToChannelType(rodType: string): string {
        const typeMap: { [key: string]: string } = {
            'Manual': 'RR',
            'Automatic': 'AR',  // Note: both AR and LAR have rod_type 'Automatic'
            'Shortened': 'USP',
            'Emergency': 'AZ',
        };
        return typeMap[rodType] || rodType;
    }
    
    /**
     * Move a rod group to a specific position
     * This updates the internal state only - backend call is handled by main.ts
     */
    public moveRodGroup(rodType: ChannelType | string, position: number): void {
        const group = this.rodGroups.get(rodType as ChannelType);
        if (group) {
            group.position = position;
            
            // Update all rods of this type in internal state
            // Use channel_type for matching (RR, AR, LAR, USP, AZ)
            for (const [key, rod] of this.controlRods) {
                const channelType = rod.channel_type || this.mapRodTypeToChannelType(rod.rod_type);
                if (channelType === rodType) {
                    rod.position = position;
                }
            }
        }
    }
    
    /**
     * Move an individual rod to a specific position
     * This updates the internal state only - backend call is handled by main.ts
     */
    public moveIndividualRod(gridX: number, gridY: number, position: number): void {
        const key = `${gridX},${gridY}`;
        const rod = this.controlRods.get(key);
        if (rod) {
            rod.position = position;
        }
    }
    
    /**
     * Get selected rod info
     */
    public getSelectedRod(): CoreChannel | null {
        return this.selectedRod;
    }
    
    /**
     * Get rod data for a channel
     */
    public getRodData(gridX: number, gridY: number): ControlRodData | undefined {
        const key = `${gridX},${gridY}`;
        return this.controlRods.get(key);
    }
    
    /**
     * Get all rod groups
     */
    public getRodGroups(): Map<ChannelType, RodGroup> {
        return this.rodGroups;
    }
    
    private handleMouseMove(e: MouseEvent): void {
        if (this.mode !== 'individual') return;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Find hovered rod
        this.hoveredRod = this.findRodAtPosition(mouseX, mouseY);
        this.canvas.style.cursor = this.hoveredRod ? 'pointer' : 'default';
    }
    
    private handleClick(e: MouseEvent): void {
        if (this.mode !== 'individual') return;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const clickedRod = this.findRodAtPosition(mouseX, mouseY);
        
        if (clickedRod) {
            this.selectedRod = clickedRod;
            console.log('[CYS] Selected rod:', clickedRod.type, 'at', clickedRod.gridX, clickedRod.gridY);
            
            // Notify about rod selection
            if (this.onRodSelected) {
                const rodKey = `${clickedRod.gridX},${clickedRod.gridY}`;
                const rodData = this.controlRods.get(rodKey);
                this.onRodSelected(clickedRod, rodData);
            }
        }
    }
    
    private findRodAtPosition(screenX: number, screenY: number): CoreChannel | null {
        const cellSize = this.GRID_SPACING * this.scale;
        const hitRadius = cellSize * 0.6;
        
        for (const channel of this.coreLayout) {
            // Only control rods (not TK fuel channels)
            if (channel.type === 'TK' || channel.type === 'GRAPHITE') continue;
            
            const cx = this.offsetX + channel.x * this.scale;
            const cy = this.offsetY + channel.y * this.scale;
            
            const dx = screenX - cx;
            const dy = screenY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < hitRadius) {
                return channel;
            }
        }
        
        return null;
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
        
        // Draw core background
        this.drawCoreBackground();
        
        // Draw all channels
        this.drawChannels();
        
        // Draw core boundary
        this.drawCoreBoundary();
        
        // Draw legend
        this.drawLegend();
        
        // Draw mode indicator
        this.drawModeIndicator();
        
        // Draw selected rod info (in individual mode)
        if (this.mode === 'individual' && this.selectedRod) {
            this.drawSelectedRodInfo();
        }
    }
    
    private drawCoreBackground(): void {
        const ctx = this.ctx;
        const radius = this.CORE_RADIUS * this.scale;
        
        // Core background
        ctx.beginPath();
        ctx.arc(this.offsetX, this.offsetY, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(22, 33, 62, 0.5)';
        ctx.fill();
    }
    
    private drawChannels(): void {
        const ctx = this.ctx;
        const cellSize = this.GRID_SPACING * this.scale * 0.8;
        
        for (const channel of this.coreLayout) {
            const cx = this.offsetX + channel.x * this.scale;
            const cy = this.offsetY + channel.y * this.scale;
            
            // Get rod position if this is a control rod
            const rodKey = `${channel.gridX},${channel.gridY}`;
            const rodData = this.controlRods.get(rodKey);
            const position = rodData?.position ?? 0;
            
            // Determine color based on channel type
            let color: string;
            let alpha = 1.0;
            
            if (channel.type === 'TK') {
                // Fuel channels - dim gray
                color = 'rgba(100, 100, 100, 0.3)';
                alpha = 0.3;
            } else {
                // Control rods - use type color
                const colorData = CHANNEL_COLORS[channel.type];
                color = `rgb(${Math.round(colorData.r * 255)}, ${Math.round(colorData.g * 255)}, ${Math.round(colorData.b * 255)})`;
                
                // Dim if inserted (position = 0)
                alpha = 0.3 + position * 0.7;
            }
            
            // Draw channel
            ctx.beginPath();
            ctx.arc(cx, cy, cellSize / 2, 0, Math.PI * 2);
            
            if (channel.type === 'TK') {
                ctx.fillStyle = color;
            } else {
                ctx.fillStyle = color;
                ctx.globalAlpha = alpha;
            }
            ctx.fill();
            ctx.globalAlpha = 1.0;
            
            // Highlight selected rod
            if (this.selectedRod && 
                this.selectedRod.gridX === channel.gridX && 
                this.selectedRod.gridY === channel.gridY) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
            
            // Highlight hovered rod
            if (this.hoveredRod && 
                this.hoveredRod.gridX === channel.gridX && 
                this.hoveredRod.gridY === channel.gridY) {
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            
            // Draw position indicator for control rods
            if (channel.type !== 'TK' && channel.type !== 'GRAPHITE' && position > 0) {
                // Draw a small indicator showing extraction level
                const indicatorSize = cellSize * 0.3;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(cx, cy, indicatorSize * position, 0, Math.PI * 2);
                ctx.fill();
            }
        }
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
    }
    
    private drawLegend(): void {
        const ctx = this.ctx;
        const legendX = 15;
        let legendY = 15;
        const lineHeight = 22;
        const boxSize = 14;
        
        // Panel background
        ctx.fillStyle = 'rgba(22, 33, 62, 0.9)';
        ctx.fillRect(legendX - 5, legendY - 5, 200, lineHeight * 6 + 10);
        ctx.strokeStyle = '#0f3460';
        ctx.lineWidth = 1;
        ctx.strokeRect(legendX - 5, legendY - 5, 200, lineHeight * 6 + 10);
        
        // Title
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#e94560';
        ctx.fillText('Control Rod Types', legendX, legendY + 12);
        legendY += lineHeight + 5;
        
        // Rod types
        const types: [ChannelType, string][] = [
            ['RR', 'RR - Manual (146)'],
            ['AR', 'AR - Automatic (8)'],
            ['LAR', 'LAR - Local Auto (12)'],
            ['USP', 'USP - Shortened (24)'],
            ['AZ', 'AZ - Emergency (33)'],
        ];
        
        ctx.font = '11px "Segoe UI", sans-serif';
        
        for (const [type, label] of types) {
            const colorData = CHANNEL_COLORS[type];
            const group = this.rodGroups.get(type);
            const position = group?.position ?? 0;
            
            // Color box
            ctx.fillStyle = `rgb(${Math.round(colorData.r * 255)}, ${Math.round(colorData.g * 255)}, ${Math.round(colorData.b * 255)})`;
            ctx.fillRect(legendX, legendY, boxSize, boxSize);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.strokeRect(legendX, legendY, boxSize, boxSize);
            
            // Label
            ctx.fillStyle = '#ccc';
            ctx.fillText(label, legendX + boxSize + 8, legendY + 11);
            
            // Position indicator
            ctx.fillStyle = '#4ade80';
            ctx.fillText(`${Math.round(position * 100)}%`, legendX + 160, legendY + 11);
            
            legendY += lineHeight;
        }
    }
    
    private drawModeIndicator(): void {
        const ctx = this.ctx;
        const x = this.canvas.width - 150;
        const y = 15;
        
        ctx.fillStyle = 'rgba(22, 33, 62, 0.9)';
        ctx.fillRect(x - 5, y - 5, 145, 30);
        ctx.strokeStyle = '#0f3460';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 5, y - 5, 145, 30);
        
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#e94560';
        ctx.fillText('Mode:', x, y + 15);
        
        ctx.fillStyle = this.mode === 'group' ? '#4ade80' : '#fbbf24';
        ctx.fillText(this.mode === 'group' ? 'Group Control' : 'Individual', x + 45, y + 15);
    }
    
    private drawSelectedRodInfo(): void {
        if (!this.selectedRod) return;
        
        const ctx = this.ctx;
        const x = this.canvas.width - 200;
        const y = this.canvas.height - 120;
        
        const rodKey = `${this.selectedRod.gridX},${this.selectedRod.gridY}`;
        const rodData = this.controlRods.get(rodKey);
        const position = rodData?.position ?? 0;
        
        // Panel background
        ctx.fillStyle = 'rgba(22, 33, 62, 0.95)';
        ctx.fillRect(x - 5, y - 5, 195, 115);
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 5, y - 5, 195, 115);
        
        // Title
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#e94560';
        ctx.fillText('Selected Rod', x, y + 15);
        
        // Info
        ctx.font = '11px "Consolas", monospace';
        ctx.fillStyle = '#aaa';
        ctx.fillText(`Type: ${this.selectedRod.type}`, x, y + 35);
        ctx.fillText(`Grid: (${this.selectedRod.gridX}, ${this.selectedRod.gridY})`, x, y + 50);
        ctx.fillText(`Position: ${Math.round(position * 100)}%`, x, y + 65);
        
        // Position bar
        const barX = x;
        const barY = y + 75;
        const barWidth = 180;
        const barHeight = 12;
        
        ctx.fillStyle = '#0f3460';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(barX, barY, barWidth * position, barHeight);
        
        ctx.strokeStyle = '#1a4a7a';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);
        
        // Labels
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillStyle = '#888';
        ctx.fillText('0%', barX, barY + barHeight + 12);
        ctx.fillText('100%', barX + barWidth - 25, barY + barHeight + 12);
    }
    
    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopAnimation();
    }
}
