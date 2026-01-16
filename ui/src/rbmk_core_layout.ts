/**
 * RBMK-1000 Core Layout Generator
 * Based on OPB-82 second generation reactor after modernization
 * 
 * Core structure:
 * - 48x48 grid of graphite blocks (25x25 cm each)
 * - Circular core with ~11.8m diameter
 * - Total 1884 channels in circular arrangement
 * 
 * Channel types:
 * - TK (1661): Technological channels (fuel assemblies)
 * - RR (146): Manual control rods
 * - AR (8): Automatic control rods
 * - USP (24): Shortened absorber rods (from below)
 * - LAR (12): Local automatic control rods
 * - AZ (33): Emergency protection rods
 */

export type ChannelType = 'TK' | 'RR' | 'AR' | 'USP' | 'LAR' | 'AZ' | 'GRAPHITE';

export interface CoreChannel {
    id: number;
    type: ChannelType;
    gridX: number;  // 0-47 grid position
    gridY: number;  // 0-47 grid position
    x: number;      // cm from center
    y: number;      // cm from center
}

// Grid spacing in cm (25x25 cm graphite blocks)
const GRID_SPACING = 25.0;
const CORE_RADIUS = 593.0; // cm (11.86m diameter)
const GRID_SIZE = 48;

// Channel colors for visualization
export const CHANNEL_COLORS = {
    TK: { r: 0.85, g: 0.75, b: 0.5 },      // Tan/beige - fuel channels
    RR: { r: 1.0, g: 1.0, b: 1.0 },         // White - manual control
    AR: { r: 0.0, g: 0.4, b: 1.0 },         // Blue - automatic control
    USP: { r: 1.0, g: 0.85, b: 0.0 },       // Yellow - shortened absorbers
    LAR: { r: 0.0, g: 0.7, b: 0.7 },        // Cyan - local automatic
    AZ: { r: 1.0, g: 0.0, b: 0.0 },         // Red - emergency
    GRAPHITE: { r: 0.4, g: 0.4, b: 0.45 },  // Gray - graphite moderator
};

/**
 * Generate the RBMK-1000 core layout based on actual reactor design
 * The pattern follows the real RBMK control rod distribution
 */
export function generateRBMKCoreLayout(): CoreChannel[] {
    const channels: CoreChannel[] = [];
    let channelId = 0;
    
    // Control rod positions based on RBMK-1000 design
    // These are approximate positions matching the real reactor pattern
    
    // AZ (Emergency) positions - 33 rods distributed across core
    const azPositions = new Set<string>([
        // Outer ring
        '8,24', '16,8', '24,8', '32,8', '40,24',
        '8,16', '40,16', '8,32', '40,32',
        '16,40', '24,40', '32,40',
        // Middle ring
        '12,12', '24,12', '36,12',
        '12,24', '36,24',
        '12,36', '24,36', '36,36',
        // Inner positions
        '18,18', '30,18', '18,30', '30,30',
        '24,18', '18,24', '30,24', '24,30',
        // Center cross
        '24,24', '20,24', '28,24', '24,20', '24,28',
    ]);
    
    // AR (Automatic) positions - 8 rods near center
    const arPositions = new Set<string>([
        '22,22', '26,22', '22,26', '26,26',
        '20,20', '28,20', '20,28', '28,28',
    ]);
    
    // LAR (Local Automatic) positions - 12 rods
    const larPositions = new Set<string>([
        '16,16', '32,16', '16,32', '32,32',
        '16,24', '32,24', '24,16', '24,32',
        '20,16', '28,16', '20,32', '28,32',
    ]);
    
    // USP (Shortened absorbers) positions - 24 rods
    const uspPositions = new Set<string>([
        '14,14', '22,14', '26,14', '34,14',
        '14,22', '34,22',
        '14,26', '34,26',
        '14,34', '22,34', '26,34', '34,34',
        '10,18', '38,18', '10,30', '38,30',
        '18,10', '30,10', '18,38', '30,38',
        '10,24', '38,24', '24,10', '24,38',
    ]);
    
    // RR (Manual control) positions - 146 rods in regular pattern
    // They form a regular grid pattern every 4 cells
    const rrPositions = new Set<string>();
    for (let gx = 4; gx < GRID_SIZE; gx += 4) {
        for (let gy = 4; gy < GRID_SIZE; gy += 4) {
            const key = `${gx},${gy}`;
            // Don't place RR where other control rods are
            if (!azPositions.has(key) && !arPositions.has(key) && 
                !larPositions.has(key) && !uspPositions.has(key)) {
                const cx = (gx - GRID_SIZE / 2) * GRID_SPACING;
                const cy = (gy - GRID_SIZE / 2) * GRID_SPACING;
                const dist = Math.sqrt(cx * cx + cy * cy);
                if (dist < CORE_RADIUS - 50) {
                    rrPositions.add(key);
                }
            }
        }
    }
    
    // Generate all channels
    for (let gx = 0; gx < GRID_SIZE; gx++) {
        for (let gy = 0; gy < GRID_SIZE; gy++) {
            // Calculate position from center
            const cx = (gx - GRID_SIZE / 2 + 0.5) * GRID_SPACING;
            const cy = (gy - GRID_SIZE / 2 + 0.5) * GRID_SPACING;
            const dist = Math.sqrt(cx * cx + cy * cy);
            
            // Skip positions outside the circular core
            if (dist > CORE_RADIUS) continue;
            
            const key = `${gx},${gy}`;
            let type: ChannelType;
            
            if (azPositions.has(key)) {
                type = 'AZ';
            } else if (arPositions.has(key)) {
                type = 'AR';
            } else if (larPositions.has(key)) {
                type = 'LAR';
            } else if (uspPositions.has(key)) {
                type = 'USP';
            } else if (rrPositions.has(key)) {
                type = 'RR';
            } else {
                type = 'TK';  // Everything else is fuel
            }
            
            channels.push({
                id: channelId++,
                type,
                gridX: gx,
                gridY: gy,
                x: cx,
                y: cy,
            });
        }
    }
    
    return channels;
}

/**
 * Get channel counts by type
 */
export function getChannelCounts(channels: CoreChannel[]): Record<ChannelType, number> {
    const counts: Record<ChannelType, number> = {
        TK: 0, RR: 0, AR: 0, USP: 0, LAR: 0, AZ: 0, GRAPHITE: 0
    };
    
    for (const ch of channels) {
        counts[ch.type]++;
    }
    
    return counts;
}

/**
 * Get channels by type
 */
export function getChannelsByType(channels: CoreChannel[], type: ChannelType): CoreChannel[] {
    return channels.filter(ch => ch.type === type);
}

/**
 * Convert channel type to rod_type string for backend
 */
export function channelTypeToRodType(type: ChannelType): string {
    switch (type) {
        case 'AZ': return 'Emergency';
        case 'AR': return 'Automatic';
        case 'LAR': return 'Automatic';  // LAR behaves like AR
        case 'USP': return 'Shortened';
        case 'RR': return 'Manual';
        default: return 'Manual';
    }
}
