/**
 * RBMK-1000 Reactor Simulator - Graphs Module
 * Real-time parameter graphs with historical data
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
    time: number;
    value: number;
}

export class ReactorGraphs {
    private graphs: Map<string, GraphConfig> = new Map();
    private dataHistory: Map<string, DataPoint[]> = new Map();
    private maxDataPoints: number = 300; // 5 minutes at 1 point per second
    private canvases: Map<string, HTMLCanvasElement> = new Map();
    private contexts: Map<string, CanvasRenderingContext2D> = new Map();
    private lastUpdateTime: number = 0;
    private readonly MIN_UPDATE_INTERVAL: number = 100; // ms between data points
    
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
        
        // Initial draw
        this.drawAllGraphs();
        
        // Handle resize
        window.addEventListener('resize', () => this.drawAllGraphs());
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
        // Throttle updates to prevent too many data points
        const now = performance.now();
        if (now - this.lastUpdateTime < this.MIN_UPDATE_INTERVAL) {
            return;
        }
        this.lastUpdateTime = now;
        
        const time = state.time;
        
        // Only add data if values are valid
        if (Number.isFinite(state.power_mw)) {
            this.addDataPoint('power', time, state.power_mw);
        }
        if (Number.isFinite(state.k_eff)) {
            this.addDataPoint('keff', time, state.k_eff);
        }
        if (Number.isFinite(state.reactivity_dollars)) {
            this.addDataPoint('reactivity', time, state.reactivity_dollars);
        }
        if (Number.isFinite(state.avg_fuel_temp)) {
            this.addDataPoint('fuel-temp', time, state.avg_fuel_temp);
        }
        if (Number.isFinite(state.avg_coolant_temp)) {
            this.addDataPoint('coolant-temp', time, state.avg_coolant_temp);
        }
        if (Number.isFinite(state.avg_graphite_temp)) {
            this.addDataPoint('graphite-temp', time, state.avg_graphite_temp);
        }
        if (Number.isFinite(state.avg_coolant_void)) {
            this.addDataPoint('void', time, state.avg_coolant_void);
        }
        if (Number.isFinite(state.xenon_135)) {
            this.addDataPoint('xenon', time, state.xenon_135);
        }
        
        // Handle period specially - clamp infinite values
        let period = state.period;
        if (!Number.isFinite(period) || Math.abs(period) > 1000) {
            period = period > 0 ? 1000 : -1000;
        }
        this.addDataPoint('period', time, period);
        
        // Redraw all graphs
        this.drawAllGraphs();
    }
    
    private addDataPoint(graphId: string, time: number, value: number): void {
        const history = this.dataHistory.get(graphId);
        if (!history) return;
        
        // Add new point
        history.push({ time, value });
        
        // Remove old points if exceeding max
        while (history.length > this.maxDataPoints) {
            history.shift();
        }
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
        const history = this.dataHistory.get(graphId);
        
        if (!canvas || !ctx || !config || !history) return;
        
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
        this.drawGrid(ctx, width, height, config);
        
        // Draw threshold lines
        this.drawThresholds(ctx, width, height, config);
        
        // Draw data - show even with just 1 point
        if (history.length >= 1) {
            this.drawDataLine(ctx, width, height, config, history);
        }
        
        // Draw current value
        if (history.length > 0) {
            this.drawCurrentValue(ctx, width, height, config, history[history.length - 1].value);
        }
    }
    
    private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, config: GraphConfig): void {
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
        
        // Draw Y-axis labels
        ctx.fillStyle = '#666';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        
        const minVal = config.minValue ?? 0;
        const maxVal = config.maxValue ?? 100;
        
        for (let i = 0; i <= 4; i++) {
            const y = (height / 4) * i + 10;
            const value = maxVal - ((maxVal - minVal) / 4) * i;
            let label: string;
            
            if (config.id === 'xenon') {
                label = value.toExponential(1);
            } else if (Math.abs(value) >= 1000) {
                label = (value / 1000).toFixed(1) + 'k';
            } else {
                label = value.toFixed(config.id === 'keff' ? 3 : 0);
            }
            
            ctx.fillText(label, 3, y);
        }
    }
    
    private drawThresholds(ctx: CanvasRenderingContext2D, width: number, height: number, config: GraphConfig): void {
        const minVal = config.minValue ?? 0;
        const maxVal = config.maxValue ?? 100;
        
        // Warning threshold
        if (config.warningThreshold !== undefined) {
            const y = height - ((config.warningThreshold - minVal) / (maxVal - minVal)) * height;
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
        if (config.criticalThreshold !== undefined) {
            const y = height - ((config.criticalThreshold - minVal) / (maxVal - minVal)) * height;
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
    
    private drawDataLine(ctx: CanvasRenderingContext2D, width: number, height: number, config: GraphConfig, history: DataPoint[]): void {
        // Calculate auto-scaled min/max based on actual data
        const values = history.map(p => p.value);
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
        
        for (let i = 0; i < history.length; i++) {
            // Position based on actual data points count
            const x = padding + (i / Math.max(history.length - 1, 1)) * (width - padding * 2);
            let value = history[i].value;
            
            // Clamp value to range
            value = Math.max(minVal, Math.min(maxVal, value));
            const y = (height - padding) - ((value - minVal) / range) * drawHeight;
            
            ctx.lineTo(x, y);
        }
        
        const lastX = padding + ((history.length - 1) / Math.max(history.length - 1, 1)) * (width - padding * 2);
        ctx.lineTo(lastX, height - padding);
        ctx.closePath();
        ctx.fill();
        
        // Draw line
        ctx.strokeStyle = config.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        for (let i = 0; i < history.length; i++) {
            const x = padding + (i / Math.max(history.length - 1, 1)) * (width - padding * 2);
            let value = history[i].value;
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
        if (history.length > 0) {
            const lastPoint = history[history.length - 1];
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
}
