/**
 * RBMK-1000 Reactor Simulator - Graphs Module
 * Real-time parameter graphs with historical data and time range selection
 */

interface GraphConfig {
    id: string;
    label: string;
    color: string;
    minValue?: number;
    maxValue?: number;
    unit: string;
    warningThreshold?: number;
    criticalThreshold?: number;
    autoScale?: boolean;
}

interface DataPoint {
    timestamp: number;  // Real timestamp in ms
    simTime: number;    // Simulation time
    value: number;
}

// Time range options in seconds
type TimeRange = 10 | 30 | 60 | 300 | 3600 | 86400;

export class ReactorGraphs {
    private graphs: Map<string, GraphConfig> = new Map();
    private dataHistory: Map<string, DataPoint[]> = new Map();
    private maxDataPoints: number = 100000; // Store lots of data
    private canvases: Map<string, HTMLCanvasElement> = new Map();
    private contexts: Map<string, CanvasRenderingContext2D> = new Map();
    private lastUpdateTime: number = 0;
    private readonly MIN_UPDATE_INTERVAL: number = 100; // ms between data points
    
    // Current time range for display (in seconds)
    private currentTimeRange: TimeRange = 10;
    
    constructor() {
        this.initializeGraphConfigs();
    }
    
    private initializeGraphConfigs(): void {
        const configs: GraphConfig[] = [
            { id: 'power', label: 'Thermal Power', color: '#e94560', unit: 'MW', minValue: 0, maxValue: 4000, warningThreshold: 3200, criticalThreshold: 3500, autoScale: true },
            { id: 'keff', label: 'k-effective', color: '#4ade80', unit: '', minValue: 0.95, maxValue: 1.05, warningThreshold: 1.01, criticalThreshold: 1.02, autoScale: true },
            { id: 'reactivity', label: 'Reactivity', color: '#fbbf24', unit: '$', minValue: -2, maxValue: 2, warningThreshold: 0.5, criticalThreshold: 1.0, autoScale: true },
            { id: 'fuel-temp', label: 'Fuel Temperature', color: '#ef4444', unit: 'K', minValue: 300, maxValue: 1500, warningThreshold: 1000, criticalThreshold: 1200, autoScale: true },
            { id: 'coolant-temp', label: 'Coolant Temperature', color: '#3b82f6', unit: 'K', minValue: 300, maxValue: 700, warningThreshold: 550, criticalThreshold: 600, autoScale: true },
            { id: 'graphite-temp', label: 'Graphite Temperature', color: '#8b5cf6', unit: 'K', minValue: 300, maxValue: 1000, warningThreshold: 700, criticalThreshold: 850, autoScale: true },
            { id: 'void', label: 'Void Fraction', color: '#06b6d4', unit: '%', minValue: 0, maxValue: 100, warningThreshold: 30, criticalThreshold: 50, autoScale: true },
            { id: 'xenon', label: 'Xenon-135', color: '#f97316', unit: 'at/cm³', minValue: 0, maxValue: 1e16, autoScale: true },
            { id: 'period', label: 'Reactor Period', color: '#ec4899', unit: 's', minValue: -100, maxValue: 100, warningThreshold: 20, criticalThreshold: 10, autoScale: true },
        ];
        
        for (const config of configs) {
            this.graphs.set(config.id, config);
            this.dataHistory.set(config.id, []);
        }
    }
    
    /**
     * Initialize canvas elements for all graphs
     */
    public initialize(): void {
        for (const [id] of this.graphs) {
            const canvas = document.getElementById(`graph-${id}`) as HTMLCanvasElement;
            if (canvas) {
                this.canvases.set(id, canvas);
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    this.contexts.set(id, ctx);
                }
            }
        }
        
        // Setup time range buttons
        this.setupTimeRangeButtons();
        
        // Initial draw
        this.drawAllGraphs();
        
        // Handle resize
        window.addEventListener('resize', () => this.drawAllGraphs());
    }
    
    /**
     * Setup time range button event handlers
     */
    private setupTimeRangeButtons(): void {
        document.querySelectorAll('.time-range-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const range = parseInt((e.target as HTMLElement).dataset.range || '10') as TimeRange;
                this.setTimeRange(range);
                
                // Update active state
                document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
                (e.target as HTMLElement).classList.add('active');
            });
        });
    }
    
    /**
     * Set the time range for graph display
     */
    public setTimeRange(range: TimeRange): void {
        this.currentTimeRange = range;
        console.log(`[Graphs] Time range set to ${range} seconds`);
        this.drawAllGraphs();
    }
    
    /**
     * Update graph data with new reactor state
     */
    public updateData(state: {
        time: number;
        power_mw: number;
        k_eff: number;
        reactivity_dollars: number;
        avg_fuel_temp: number;
        avg_coolant_temp: number;
        avg_graphite_temp: number;
        avg_coolant_void: number;
        xenon_135: number;
        period: number;
    }): void {
        const now = performance.now();
        
        // Always redraw graphs (to update time-based filtering)
        // But only add new data points at throttled rate
        const shouldAddData = (now - this.lastUpdateTime) >= this.MIN_UPDATE_INTERVAL;
        
        if (shouldAddData) {
            this.lastUpdateTime = now;
            
            const timestamp = Date.now(); // Use real timestamp
            const simTime = state.time;
            
            // Only add data if values are valid
            if (Number.isFinite(state.power_mw)) {
                this.addDataPoint('power', timestamp, simTime, state.power_mw);
            }
            if (Number.isFinite(state.k_eff)) {
                this.addDataPoint('keff', timestamp, simTime, state.k_eff);
            }
            if (Number.isFinite(state.reactivity_dollars)) {
                this.addDataPoint('reactivity', timestamp, simTime, state.reactivity_dollars);
            }
            if (Number.isFinite(state.avg_fuel_temp)) {
                this.addDataPoint('fuel-temp', timestamp, simTime, state.avg_fuel_temp);
            }
            if (Number.isFinite(state.avg_coolant_temp)) {
                this.addDataPoint('coolant-temp', timestamp, simTime, state.avg_coolant_temp);
            }
            if (Number.isFinite(state.avg_graphite_temp)) {
                this.addDataPoint('graphite-temp', timestamp, simTime, state.avg_graphite_temp);
            }
            if (Number.isFinite(state.avg_coolant_void)) {
                this.addDataPoint('void', timestamp, simTime, state.avg_coolant_void);
            }
            if (Number.isFinite(state.xenon_135)) {
                this.addDataPoint('xenon', timestamp, simTime, state.xenon_135);
            }
            
            // Handle period specially - clamp infinite values
            let period = state.period;
            if (!Number.isFinite(period) || Math.abs(period) > 1000) {
                period = period > 0 ? 1000 : -1000;
            }
            this.addDataPoint('period', timestamp, simTime, period);
        }
        
        // Always redraw all graphs (to update time-based filtering)
        this.drawAllGraphs();
    }
    
    private addDataPoint(graphId: string, timestamp: number, simTime: number, value: number): void {
        const history = this.dataHistory.get(graphId);
        if (!history) return;
        
        // Add new point
        history.push({ timestamp, simTime, value });
        
        // Remove old points if exceeding max
        while (history.length > this.maxDataPoints) {
            history.shift();
        }
    }
    
    /**
     * Get data for display based on current time range with averaging
     * Uses real timestamps for filtering
     */
    private getDisplayData(graphId: string): DataPoint[] {
        const history = this.dataHistory.get(graphId);
        if (!history || history.length === 0) return [];
        
        const now = Date.now();
        const cutoffTime = now - (this.currentTimeRange * 1000); // Convert seconds to ms
        
        // Filter data within time range using real timestamps
        const filteredData = history.filter(p => p.timestamp >= cutoffTime);
        
        if (filteredData.length === 0) {
            // If no data in range, return the last point
            return history.length > 0 ? [history[history.length - 1]] : [];
        }
        
        // For short time ranges (10s, 30s, 1min), show raw data (up to 200 points)
        if (this.currentTimeRange <= 60 && filteredData.length <= 200) {
            return filteredData;
        }
        
        // For longer time ranges or lots of data, average into buckets
        const numBuckets = Math.min(100, filteredData.length); // Max 100 points on graph
        const bucketSize = Math.ceil(filteredData.length / numBuckets);
        
        const averagedData: DataPoint[] = [];
        
        for (let i = 0; i < filteredData.length; i += bucketSize) {
            const bucket = filteredData.slice(i, Math.min(i + bucketSize, filteredData.length));
            if (bucket.length === 0) continue;
            
            const avgTimestamp = bucket.reduce((sum, p) => sum + p.timestamp, 0) / bucket.length;
            const avgSimTime = bucket.reduce((sum, p) => sum + p.simTime, 0) / bucket.length;
            const avgValue = bucket.reduce((sum, p) => sum + p.value, 0) / bucket.length;
            
            averagedData.push({ timestamp: avgTimestamp, simTime: avgSimTime, value: avgValue });
        }
        
        return averagedData;
    }
    
    /**
     * Clear all historical data
     */
    public clearData(): void {
        for (const [id] of this.graphs) {
            this.dataHistory.set(id, []);
        }
        this.drawAllGraphs();
    }
    
    /**
     * Draw all graphs
     */
    public drawAllGraphs(): void {
        for (const [id] of this.graphs) {
            this.drawGraph(id);
        }
    }
    
    private drawGraph(graphId: string): void {
        const canvas = this.canvases.get(graphId);
        const ctx = this.contexts.get(graphId);
        const config = this.graphs.get(graphId);
        
        if (!canvas || !ctx || !config) return;
        
        // Get display data (filtered and averaged based on time range)
        const displayData = this.getDisplayData(graphId);
        
        // Set canvas size to match display size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const width = rect.width;
        const height = rect.height;
        
        // Clear canvas
        ctx.fillStyle = '#0f3460';
        ctx.fillRect(0, 0, width, height);
        
        // Draw grid
        this.drawGrid(ctx, width, height, config, displayData);
        
        // Draw threshold lines
        this.drawThresholds(ctx, width, height, config, displayData);
        
        // Draw data - show even with just 1 point
        if (displayData.length >= 1) {
            this.drawDataLine(ctx, width, height, config, displayData);
        }
        
        // Draw current value
        if (displayData.length > 0) {
            this.drawCurrentValue(ctx, width, height, config, displayData[displayData.length - 1].value);
        }
        
        // Draw time range label and data count
        this.drawTimeRangeLabel(ctx, width, height, displayData.length);
    }
    
    private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, config: GraphConfig, displayData: DataPoint[]): void {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        
        // Horizontal grid lines
        for (let i = 0; i <= 4; i++) {
            const y = (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Vertical grid lines
        for (let i = 0; i <= 6; i++) {
            const x = (width / 6) * i;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
    }
    
    private drawThresholds(ctx: CanvasRenderingContext2D, width: number, height: number, config: GraphConfig, displayData: DataPoint[]): void {
        if (displayData.length === 0) return;
        
        // Calculate auto-scaled range
        const values = displayData.map(p => p.value);
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        const dataPadding = Math.max((dataMax - dataMin) * 0.1, 0.001);
        
        let minVal = dataMin - dataPadding;
        let maxVal = dataMax + dataPadding;
        
        if (maxVal - minVal < Math.abs(dataMax) * 0.01) {
            const center = (dataMax + dataMin) / 2;
            const halfRange = Math.max(Math.abs(center) * 0.01, 1);
            minVal = center - halfRange;
            maxVal = center + halfRange;
        }
        
        const range = maxVal - minVal || 1;
        const padding = 15;
        const drawHeight = height - padding * 2;
        
        // Warning threshold
        if (config.warningThreshold !== undefined && config.warningThreshold >= minVal && config.warningThreshold <= maxVal) {
            const y = (height - padding) - ((config.warningThreshold - minVal) / range) * drawHeight;
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        // Critical threshold
        if (config.criticalThreshold !== undefined && config.criticalThreshold >= minVal && config.criticalThreshold <= maxVal) {
            const y = (height - padding) - ((config.criticalThreshold - minVal) / range) * drawHeight;
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    
    private drawDataLine(ctx: CanvasRenderingContext2D, width: number, height: number, config: GraphConfig, displayData: DataPoint[]): void {
        // Calculate auto-scaled min/max based on actual data
        const values = displayData.map(p => p.value);
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        
        // Add 10% padding to the range for better visualization
        const dataPadding = Math.max((dataMax - dataMin) * 0.1, 0.001);
        
        // Use auto-scaling: show the actual data range with padding
        let minVal = dataMin - dataPadding;
        let maxVal = dataMax + dataPadding;
        
        // Ensure we have a reasonable range (at least 1% of the value)
        if (maxVal - minVal < Math.abs(dataMax) * 0.01) {
            const center = (dataMax + dataMin) / 2;
            const halfRange = Math.max(Math.abs(center) * 0.01, 1);
            minVal = center - halfRange;
            maxVal = center + halfRange;
        }
        
        const range = maxVal - minVal || 1;
        const padding = 15; // Padding from edges
        const drawHeight = height - padding * 2;
        
        // Draw filled area
        ctx.fillStyle = `${config.color}33`;
        ctx.beginPath();
        ctx.moveTo(padding, height - padding);
        
        for (let i = 0; i < displayData.length; i++) {
            // Position based on actual data points count
            const x = padding + (i / Math.max(displayData.length - 1, 1)) * (width - padding * 2);
            let value = displayData[i].value;
            
            // Clamp value to range
            value = Math.max(minVal, Math.min(maxVal, value));
            const y = (height - padding) - ((value - minVal) / range) * drawHeight;
            
            ctx.lineTo(x, y);
        }
        
        const lastX = padding + ((displayData.length - 1) / Math.max(displayData.length - 1, 1)) * (width - padding * 2);
        ctx.lineTo(lastX, height - padding);
        ctx.closePath();
        ctx.fill();
        
        // Draw line
        ctx.strokeStyle = config.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        for (let i = 0; i < displayData.length; i++) {
            const x = padding + (i / Math.max(displayData.length - 1, 1)) * (width - padding * 2);
            let value = displayData[i].value;
            value = Math.max(minVal, Math.min(maxVal, value));
            const y = (height - padding) - ((value - minVal) / range) * drawHeight;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        
        // Draw a dot at the current value
        if (displayData.length > 0) {
            const lastPoint = displayData[displayData.length - 1];
            const lastValue = Math.max(minVal, Math.min(maxVal, lastPoint.value));
            const lastY = (height - padding) - ((lastValue - minVal) / range) * drawHeight;
            
            ctx.fillStyle = config.color;
            ctx.beginPath();
            ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw white border around dot
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        
        // Draw min/max labels for the auto-scaled range
        ctx.fillStyle = '#888';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        
        // Format labels based on graph type
        let minLabel: string, maxLabel: string;
        if (config.id === 'xenon') {
            minLabel = minVal.toExponential(1);
            maxLabel = maxVal.toExponential(1);
        } else if (config.id === 'keff') {
            minLabel = minVal.toFixed(4);
            maxLabel = maxVal.toFixed(4);
        } else {
            minLabel = minVal.toFixed(1);
            maxLabel = maxVal.toFixed(1);
        }
        
        ctx.fillText(maxLabel, 3, padding + 8);
        ctx.fillText(minLabel, 3, height - padding - 2);
    }
    
    private drawCurrentValue(ctx: CanvasRenderingContext2D, width: number, height: number, config: GraphConfig, value: number): void {
        // Format value
        let displayValue: string;
        if (config.id === 'xenon') {
            displayValue = value.toExponential(2);
        } else if (config.id === 'keff') {
            displayValue = value.toFixed(5);
        } else if (config.id === 'period') {
            if (!Number.isFinite(value) || Math.abs(value) >= 1000) {
                displayValue = '∞';
            } else {
                displayValue = value.toFixed(1);
            }
        } else {
            displayValue = value.toFixed(1);
        }
        
        // Determine color based on thresholds
        let textColor = config.color;
        if (config.criticalThreshold !== undefined && value >= config.criticalThreshold) {
            textColor = '#ef4444';
        } else if (config.warningThreshold !== undefined && value >= config.warningThreshold) {
            textColor = '#fbbf24';
        }
        
        // Draw current value in top-right corner
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(width - 80, 5, 75, 22);
        
        ctx.fillStyle = textColor;
        ctx.font = 'bold 12px Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${displayValue} ${config.unit}`, width - 8, 20);
    }
    
    private drawTimeRangeLabel(ctx: CanvasRenderingContext2D, width: number, height: number, dataCount: number): void {
        // Format time range label
        let label: string;
        if (this.currentTimeRange < 60) {
            label = `${this.currentTimeRange}s`;
        } else if (this.currentTimeRange < 3600) {
            label = `${this.currentTimeRange / 60}m`;
        } else if (this.currentTimeRange < 86400) {
            label = `${this.currentTimeRange / 3600}h`;
        } else {
            label = `${this.currentTimeRange / 86400}d`;
        }
        
        // Draw in bottom-right corner with data count
        const text = `${label} (${dataCount})`;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(width - 55, height - 20, 50, 15);
        
        ctx.fillStyle = '#666';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(text, width - 8, height - 8);
    }
}
