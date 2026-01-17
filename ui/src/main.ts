/**
 * RBMK-1000 Reactor Simulator - Main Entry Point
 * Integrates Tauri backend with Babylon.js 3D visualization
 */

import { invoke } from '@tauri-apps/api/core';
import { ReactorVisualization, Reactor3DData, ControlRod } from './visualization';
import { ChannelType } from './rbmk_core_layout';
import { ReactorGraphs } from './graphs';
import { Reactor2DProjection, Visualization2DMode, FuelChannelData } from './reactor_2d';
import { ReactorHeatmap, HeatmapMode } from './reactor_heatmap';

// Auto regulator settings interface
interface AutoRegulatorSettings {
    enabled: boolean;
    target_power: number;
    kp: number;
    ki: number;
    kd: number;
    integral_error: number;
    last_error: number;
    rod_speed: number;
    deadband: number;
}

// Reactor state interface (matches Rust struct)
interface ReactorState {
    time: number;
    dt: number;
    power_mw: number;
    power_percent: number;
    neutron_population: number;
    precursors: number;
    k_eff: number;
    reactivity: number;
    reactivity_dollars: number;
    period: number;
    iodine_135: number;
    xenon_135: number;
    xenon_reactivity: number;
    avg_fuel_temp: number;
    avg_coolant_temp: number;
    avg_graphite_temp: number;
    avg_coolant_void: number;
    scram_active: boolean;
    scram_time: number;
    auto_regulator: AutoRegulatorSettings;
    axial_flux: number[];
    alerts: string[];
    // Steam explosion state - based on physics simulation
    explosion_occurred: boolean;
    explosion_time: number;
}

interface SimulationResponse {
    state: ReactorState;
    control_rods: ControlRod[];
}

class RBMKSimulator {
    private visualization: ReactorVisualization | null = null;
    private graphs: ReactorGraphs | null = null;
    private projection2D: Reactor2DProjection | null = null;
    private heatmap: ReactorHeatmap | null = null;
    private state: ReactorState | null = null;
    
    // Current view tab
    private currentTab: '3d' | '2d' | 'heatmap' | 'graphs' = '3d';
    
    // Real-time simulation properties
    // Start date: April 20, 1986 at 00:00:00 (midnight)
    // We track total simulation seconds from this starting point
    private readonly START_DATE = new Date(1986, 3, 20, 0, 0, 0); // April 20, 1986 00:00:00
    private simulationSeconds: number = 0; // Total seconds since simulation start
    private timeSpeed: number = 1; // Time multiplier (0.1, 0.5, 1, 5, 10, 100, 500, 1000)
    private isPlaying: boolean = false;
    private lastRealTime: number = 0;
    private simulationLoopId: number | null = null;
    
    // Performance optimization flags
    private isPhysicsRunning: boolean = false;
    private is3DUpdatePending: boolean = false;
    private last3DUpdateTime: number = 0;
    private readonly MIN_3D_UPDATE_INTERVAL: number = 100; // ms between 3D updates
    
    constructor() {
        this.initialize();
    }
    
    private async initialize(): Promise<void> {
        // Initialize 3D visualization (async - loads layout config from JSON)
        const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
        if (canvas) {
            try {
                this.visualization = await ReactorVisualization.create(canvas);
                
                // Get initial 3D data and initialize reactor geometry
                try {
                    const data = await invoke<Reactor3DData>('get_3d_data');
                    this.visualization.initializeReactor(data);
                } catch (e) {
                    console.error('Failed to get 3D data:', e);
                    // Use mock data for development
                    this.visualization.initializeReactor(this.getMockData());
                }
                
                // Set initial rod positions in 3D visualization to match SHUTDOWN state
                // All rods fully inserted (0%) for cold shutdown
                this.visualization.setRodPosition('RR' as ChannelType, 0.0);
                this.visualization.setRodPosition('AR' as ChannelType, 0.0);
                this.visualization.setRodPosition('LAR' as ChannelType, 0.0);
                this.visualization.setRodPosition('USP' as ChannelType, 0.0);
                this.visualization.setRodPosition('AZ' as ChannelType, 0.0);
            } catch (e) {
                console.error('Failed to create 3D visualization:', e);
            }
        }
        
        // Initialize graphs module
        this.graphs = new ReactorGraphs();
        this.graphs.initialize();
        
        // Initialize 2D projection (async - loads layout config from JSON)
        const projection2DCanvas = document.getElementById('projection2dCanvas') as HTMLCanvasElement;
        if (projection2DCanvas) {
            try {
                this.projection2D = await Reactor2DProjection.create(projection2DCanvas);
            } catch (e) {
                console.error('Failed to create 2D projection:', e);
            }
        }
        
        // Initialize Heatmap (async - loads layout config from JSON)
        const heatmapCanvas = document.getElementById('heatmapCanvas') as HTMLCanvasElement;
        if (heatmapCanvas) {
            try {
                this.heatmap = await ReactorHeatmap.create(heatmapCanvas);
            } catch (e) {
                console.error('Failed to create heatmap:', e);
            }
        }
        
        // Get initial state
        await this.updateState();
        
        // Setup UI event handlers
        this.setupEventHandlers();
        
        // Draw initial flux chart
        this.drawFluxChart();
    }
    
    private setupEventHandlers(): void {
        // Main tab switching
        document.querySelectorAll('.main-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = (e.target as HTMLElement).dataset.tab as '3d' | '2d' | 'graphs';
                this.switchTab(tabId);
            });
        });
        
        // 2D visualization mode buttons
        document.querySelectorAll('.viz-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = (e.target as HTMLElement).dataset.mode as Visualization2DMode;
                document.querySelectorAll('.viz-mode-btn').forEach(b => b.classList.remove('active'));
                (e.target as HTMLElement).classList.add('active');
                this.projection2D?.setMode(mode);
            });
        });
        
        // Heatmap mode buttons
        document.querySelectorAll('.heatmap-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = (e.target as HTMLElement).dataset.mode as HeatmapMode;
                document.querySelectorAll('.heatmap-mode-btn').forEach(b => b.classList.remove('active'));
                (e.target as HTMLElement).classList.add('active');
                this.heatmap?.setMode(mode);
            });
        });
        
        // Play/Pause button
        document.getElementById('btn-play-pause')?.addEventListener('click', () => this.togglePlayPause());
        
        // Speed control buttons
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const speed = parseFloat((e.target as HTMLElement).dataset.speed || '1');
                this.setTimeSpeed(speed);
                // Update active state
                document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
                (e.target as HTMLElement).classList.add('active');
            });
        });
        
        // Simulation control buttons
        document.getElementById('btn-step')?.addEventListener('click', () => this.step());
        document.getElementById('btn-run')?.addEventListener('click', () => this.run(10));
        document.getElementById('btn-scram')?.addEventListener('click', () => this.scram());
        document.getElementById('btn-reset')?.addEventListener('click', () => this.reset());
        
        // Control rod sliders - update both visualization and backend
        document.getElementById('manual-rods')?.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            const pos = parseInt(value) / 100;
            document.getElementById('manual-rod-pos')!.textContent = `${value}%`;
            // Update 3D visualization directly
            this.visualization?.setRodPosition('RR' as ChannelType, pos);
            // Also update backend
            this.moveRodGroup('manual', pos);
        });
        
        document.getElementById('auto-rods')?.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            const pos = parseInt(value) / 100;
            document.getElementById('auto-rod-pos')!.textContent = `${value}%`;
            // Update both AR and LAR rods
            this.visualization?.setRodPosition('AR' as ChannelType, pos);
            this.visualization?.setRodPosition('LAR' as ChannelType, pos);
            this.moveRodGroup('automatic', pos);
        });
        
        document.getElementById('usp-rods')?.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            const pos = parseInt(value) / 100;
            document.getElementById('usp-rod-pos')!.textContent = `${value}%`;
            this.visualization?.setRodPosition('USP' as ChannelType, pos);
            this.moveRodGroup('shortened', pos);
        });
        
        document.getElementById('az-rods')?.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            const pos = parseInt(value) / 100;
            document.getElementById('az-rod-pos')!.textContent = `${value}%`;
            this.visualization?.setRodPosition('AZ' as ChannelType, pos);
            this.moveRodGroup('emergency', pos);
        });
        
        // Automatic regulator controls
        document.getElementById('ar-enabled')?.addEventListener('change', (e) => {
            const enabled = (e.target as HTMLInputElement).checked;
            this.setAutoRegulatorEnabled(enabled);
            
            // Update UI to show/hide manual control of AR rods
            const autoRodsContainer = document.getElementById('auto-rods-container');
            const autoRodsSlider = document.getElementById('auto-rods') as HTMLInputElement;
            const arStatus = document.getElementById('ar-status');
            
            if (enabled) {
                autoRodsContainer?.setAttribute('style', 'opacity: 0.5;');
                autoRodsSlider?.setAttribute('disabled', 'true');
                if (arStatus) {
                    arStatus.textContent = 'ENABLED';
                    arStatus.style.color = '#4ade80';
                }
            } else {
                autoRodsContainer?.setAttribute('style', 'opacity: 1;');
                autoRodsSlider?.removeAttribute('disabled');
                if (arStatus) {
                    arStatus.textContent = 'DISABLED';
                    arStatus.style.color = '#fbbf24';
                }
            }
        });
        
        document.getElementById('target-power')?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            document.getElementById('target-power-value')!.textContent = `${value}%`;
            this.setTargetPower(value);
        });
        
        // Time step slider
        document.getElementById('time-step')?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value) / 100;
            document.getElementById('dt-value')!.textContent = `${value.toFixed(2)} s`;
            this.setTimeStep(value);
        });
        
        // View controls
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = (e.target as HTMLElement).dataset.view as '3d' | 'top' | 'side';
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                (e.target as HTMLElement).classList.add('active');
                this.visualization?.setView(view);
            });
        });
        
        // Transparency slider
        document.getElementById('transparency-slider')?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            const transparencyValueEl = document.getElementById('transparency-value');
            if (transparencyValueEl) {
                transparencyValueEl.textContent = `${value}%`;
            }
            this.visualization?.setCoreTransparency(value / 100);
        });
    }
    
    private async updateState(): Promise<void> {
        try {
            this.state = await invoke<ReactorState>('get_reactor_state');
            this.updateUI();
        } catch (e) {
            console.error('Failed to get reactor state:', e);
            // Use mock state for development
            this.state = this.getMockState();
            this.updateUI();
        }
    }
    
    private updateUI(): void {
        if (!this.state) return;
        
        // Helper to safely format numbers
        const safeFixed = (val: number | null | undefined, digits: number): string => {
            if (val === null || val === undefined || !Number.isFinite(val)) return '---';
            return val.toFixed(digits);
        };
        
        // Update power display
        const powerEl = document.getElementById('power-value');
        if (powerEl) {
            powerEl.textContent = `${safeFixed(this.state.power_mw, 0)} MW (${safeFixed(this.state.power_percent, 1)}%)`;
            powerEl.className = `parameter-value ${this.getValueClass(this.state.power_percent ?? 0, 100, 110)}`;
        }
        
        // Update k-effective
        const keffEl = document.getElementById('keff-value');
        if (keffEl) {
            keffEl.textContent = safeFixed(this.state.k_eff, 5);
            keffEl.className = `parameter-value ${this.getValueClass(Math.abs((this.state.k_eff ?? 1) - 1) * 100, 0.5, 1)}`;
        }
        
        // Update reactivity
        const reactivityEl = document.getElementById('reactivity-value');
        if (reactivityEl) {
            reactivityEl.textContent = `${safeFixed((this.state.reactivity ?? 0) * 100, 3)}% (${safeFixed(this.state.reactivity_dollars, 2)}$)`;
            reactivityEl.className = `parameter-value ${this.getValueClass(Math.abs(this.state.reactivity_dollars ?? 0), 0.5, 1)}`;
        }
        
        // Update period
        const periodEl = document.getElementById('period-value');
        if (periodEl) {
            const period = this.state.period;
            if (period === null || period === undefined || !Number.isFinite(period) || Math.abs(period) > 1e10) {
                periodEl.textContent = '∞ s';
            } else {
                periodEl.textContent = `${period.toFixed(1)} s`;
            }
            periodEl.className = `parameter-value ${period !== null && period !== undefined && Number.isFinite(period) && period > 0 && period < 20 ? 'value-warning' : 'value-normal'}`;
        }
        
        // Update temperatures
        const fuelTempEl = document.getElementById('fuel-temp');
        if (fuelTempEl) {
            fuelTempEl.textContent = `${safeFixed(this.state.avg_fuel_temp, 0)} K`;
            fuelTempEl.className = `parameter-value ${this.getValueClass(this.state.avg_fuel_temp ?? 0, 1000, 1200)}`;
        }
        
        const coolantTempEl = document.getElementById('coolant-temp');
        if (coolantTempEl) {
            coolantTempEl.textContent = `${safeFixed(this.state.avg_coolant_temp, 0)} K`;
        }
        
        const graphiteTempEl = document.getElementById('graphite-temp');
        if (graphiteTempEl) {
            graphiteTempEl.textContent = `${safeFixed(this.state.avg_graphite_temp, 0)} K`;
        }
        
        const voidEl = document.getElementById('void-fraction');
        if (voidEl) {
            voidEl.textContent = `${safeFixed(this.state.avg_coolant_void, 1)}%`;
            voidEl.className = `parameter-value ${this.getValueClass(this.state.avg_coolant_void ?? 0, 30, 50)}`;
        }
        
        // Update xenon
        const xenonEl = document.getElementById('xenon-value');
        if (xenonEl && this.state.xenon_135 != null && Number.isFinite(this.state.xenon_135)) {
            xenonEl.textContent = `${this.state.xenon_135.toExponential(2)} at/cm³`;
        }
        
        const iodineEl = document.getElementById('iodine-value');
        if (iodineEl && this.state.iodine_135 != null && Number.isFinite(this.state.iodine_135)) {
            iodineEl.textContent = `${this.state.iodine_135.toExponential(2)} at/cm³`;
        }
        
        // Update status indicator
        const statusEl = document.getElementById('status-indicator');
        if (statusEl) {
            if (this.state.scram_active) {
                statusEl.className = 'status-indicator status-scram';
            } else if (this.isPlaying) {
                statusEl.className = 'status-indicator status-running';
            } else {
                statusEl.className = 'status-indicator status-paused';
            }
        }
        
        // Update alerts
        this.updateAlerts();
        
        // Update flux chart
        this.drawFluxChart();
        
        // Update 3D visualization
        this.update3D();
        
        // Update 2D projection
        this.update2DProjection();
        
        // Update graphs
        this.updateGraphs();
        
        // Check for steam explosion - show "Connection Lost" overlay
        this.checkExplosionState();
    }
    
    private getValueClass(value: number, warningThreshold: number, criticalThreshold: number): string {
        if (value >= criticalThreshold) return 'value-critical';
        if (value >= warningThreshold) return 'value-warning';
        return 'value-normal';
    }
    
    private updateAlerts(): void {
        if (!this.state) return;
        
        const alertsList = document.getElementById('alerts-list')!;
        
        // Add new alerts with simulation time
        for (const alert of this.state.alerts) {
            const alertEl = document.createElement('div');
            alertEl.className = `alert ${alert.includes('CRITICAL') ? 'alert-critical' : 'alert-warning'}`;
            alertEl.textContent = `[${this.formatSimulationTime()}] ${alert}`;
            alertsList.insertBefore(alertEl, alertsList.firstChild);
        }
        
        // Limit number of alerts shown
        while (alertsList.children.length > 50) {
            alertsList.removeChild(alertsList.lastChild!);
        }
    }
    
    private drawFluxChart(): void {
        if (!this.state) return;
        
        const canvas = document.getElementById('flux-canvas') as HTMLCanvasElement;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d')!;
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        // Clear canvas
        ctx.fillStyle = '#0f3460';
        ctx.fillRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) {
            const y = (height / 10) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Draw flux distribution
        const flux = this.state.axial_flux;
        if (flux.length === 0) return;
        
        const maxFlux = Math.max(...flux, 0.001);
        const dx = width / (flux.length - 1);
        
        // Fill area under curve
        ctx.fillStyle = 'rgba(233, 69, 96, 0.3)';
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let i = 0; i < flux.length; i++) {
            const x = i * dx;
            const y = height - (flux[i] / maxFlux) * height * 0.9;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();
        
        // Draw line
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < flux.length; i++) {
            const x = i * dx;
            const y = height - (flux[i] / maxFlux) * height * 0.9;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        // Labels
        ctx.fillStyle = '#aaa';
        ctx.font = '10px sans-serif';
        ctx.fillText('Top', 5, 15);
        ctx.fillText('Bottom', 5, height - 5);
    }
    
    /**
     * Update 2D projection with current reactor state
     * Fetches per-channel data from backend for all 1661 fuel channels
     */
    private async update2DProjection(): Promise<void> {
        if (!this.projection2D || !this.state) return;
        
        // Update global state data
        this.projection2D.updateData({
            power_percent: this.state.power_percent,
            avg_fuel_temp: this.state.avg_fuel_temp,
            avg_coolant_temp: this.state.avg_coolant_temp,
            avg_graphite_temp: this.state.avg_graphite_temp,
            avg_coolant_void: this.state.avg_coolant_void,
        });
        
        // Fetch per-channel data from backend (1661 fuel channels with synchronized parameters)
        try {
            const fuelChannels = await invoke<FuelChannelData[]>('get_fuel_channels');
            this.projection2D.updateFuelChannels(fuelChannels);
            
            // Also update heatmap with the same data
            this.updateHeatmap(fuelChannels);
        } catch (e) {
            // Backend not available - 2D projection will use global averages
            console.debug('[2D] Could not fetch fuel channels:', e);
        }
    }
    
    /**
     * Update heatmap with current reactor state and fuel channel data
     */
    private updateHeatmap(fuelChannels?: FuelChannelData[]): void {
        if (!this.heatmap || !this.state) return;
        
        // Update global state data
        this.heatmap.updateData({
            power_percent: this.state.power_percent,
            avg_fuel_temp: this.state.avg_fuel_temp,
            avg_coolant_temp: this.state.avg_coolant_temp,
            avg_graphite_temp: this.state.avg_graphite_temp,
            avg_coolant_void: this.state.avg_coolant_void,
        });
        
        // Update per-channel data if available
        if (fuelChannels) {
            this.heatmap.updateFuelChannels(fuelChannels);
        }
    }
    
    /**
     * Update graphs with current reactor state
     */
    private updateGraphs(): void {
        if (!this.graphs || !this.state) return;
        
        this.graphs.updateData({
            time: this.state.time,
            power_mw: this.state.power_mw,
            k_eff: this.state.k_eff,
            reactivity_dollars: this.state.reactivity_dollars,
            avg_fuel_temp: this.state.avg_fuel_temp,
            avg_coolant_temp: this.state.avg_coolant_temp,
            avg_graphite_temp: this.state.avg_graphite_temp,
            avg_coolant_void: this.state.avg_coolant_void,
            xenon_135: this.state.xenon_135,
            period: this.state.period,
        });
    }
    
    private async update3D(): Promise<void> {
        if (!this.visualization || !this.state) return;
        
        // Throttle 3D updates to prevent performance issues
        const now = performance.now();
        if (now - this.last3DUpdateTime < this.MIN_3D_UPDATE_INTERVAL) {
            // Schedule a pending update if not already scheduled
            if (!this.is3DUpdatePending) {
                this.is3DUpdatePending = true;
                setTimeout(() => {
                    this.is3DUpdatePending = false;
                    this.update3D();
                }, this.MIN_3D_UPDATE_INTERVAL - (now - this.last3DUpdateTime));
            }
            return;
        }
        this.last3DUpdateTime = now;
        
        try {
            const data = await invoke<Reactor3DData>('get_3d_data');
            this.visualization.updateState(data, this.state.power_percent);
            this.visualization.highlightScram(this.state.scram_active);
            
            // Update AR rod position display from actual control rod data
            this.updateARPositionFromRods(data.control_rods);
        } catch (e) {
            // Use mock data
            const mockData = this.getMockData();
            this.visualization.updateState(mockData, this.state.power_percent);
        }
    }
    
    /**
     * Update AR rod position display from control rod data
     */
    private updateARPositionFromRods(controlRods: ControlRod[]): void {
        // Find automatic rods and calculate average position
        const autoRods = controlRods.filter(rod => rod.rod_type === 'Automatic');
        if (autoRods.length === 0) return;
        
        const avgPosition = autoRods.reduce((sum, rod) => sum + rod.position, 0) / autoRods.length;
        const positionPercent = Math.round(avgPosition * 100);
        
        // Update display
        const arPositionEl = document.getElementById('ar-position-display');
        if (arPositionEl) {
            arPositionEl.textContent = `${positionPercent}%`;
        }
        
        // Update slider (only if auto-regulation is enabled, to show current position)
        if (this.state?.auto_regulator.enabled) {
            const autoRodsSlider = document.getElementById('auto-rods') as HTMLInputElement;
            const autoRodPos = document.getElementById('auto-rod-pos');
            if (autoRodsSlider) {
                autoRodsSlider.value = String(positionPercent);
            }
            if (autoRodPos) {
                autoRodPos.textContent = `${positionPercent}%`;
            }
            
            // Update 3D visualization
            this.visualization?.setRodPosition('AR' as ChannelType, avgPosition);
            this.visualization?.setRodPosition('LAR' as ChannelType, avgPosition);
        }
    }
    
    private async step(): Promise<void> {
        try {
            const response = await invoke<SimulationResponse>('simulation_step');
            this.state = response.state;
            this.updateUI();
        } catch (e) {
            console.error('Simulation step failed:', e);
            // Mock step
            if (this.state) {
                this.state.time += this.state.dt;
                this.updateUI();
            }
        }
    }
    
    private async run(steps: number): Promise<void> {
        try {
            const response = await invoke<SimulationResponse>('simulation_run', { steps });
            this.state = response.state;
            this.updateUI();
        } catch (e) {
            console.error('Simulation run failed:', e);
        }
    }
    
    private async scram(): Promise<void> {
        try {
            this.state = await invoke<ReactorState>('scram');
            
            // Insert all control rods in visualization
            this.visualization?.setRodPosition('AZ' as ChannelType, 0);
            this.visualization?.setRodPosition('RR' as ChannelType, 0);
            this.visualization?.setRodPosition('AR' as ChannelType, 0);
            this.visualization?.setRodPosition('LAR' as ChannelType, 0);
            this.visualization?.setRodPosition('USP' as ChannelType, 0);
            
            // Update sliders to show 0%
            const sliders = ['manual-rods', 'auto-rods', 'usp-rods', 'az-rods'];
            const labels = ['manual-rod-pos', 'auto-rod-pos', 'usp-rod-pos', 'az-rod-pos'];
            sliders.forEach((id, i) => {
                const slider = document.getElementById(id) as HTMLInputElement;
                if (slider) slider.value = '0';
                const label = document.getElementById(labels[i]);
                if (label) label.textContent = '0%';
            });
            
            this.updateUI();
            
            // Add visual alert with simulation time
            const alertsList = document.getElementById('alerts-list')!;
            const alertEl = document.createElement('div');
            alertEl.className = 'alert alert-critical';
            alertEl.textContent = `[${this.formatSimulationTime()}] ⚠ EMERGENCY SCRAM INITIATED (AZ-5)`;
            alertsList.insertBefore(alertEl, alertsList.firstChild);
        } catch (e) {
            console.error('SCRAM failed:', e);
            // Still update visualization even if backend fails
            this.visualization?.setRodPosition('AZ' as ChannelType, 0);
            this.visualization?.setRodPosition('RR' as ChannelType, 0);
            this.visualization?.setRodPosition('AR' as ChannelType, 0);
            this.visualization?.setRodPosition('LAR' as ChannelType, 0);
            this.visualization?.setRodPosition('USP' as ChannelType, 0);
        }
    }
    
    private async reset(): Promise<void> {
        // Pause simulation if running
        if (this.isPlaying) {
            this.pauseSimulation();
        }
        
        // Hide connection lost overlay if shown
        this.visualization?.hideConnectionLost();
        
        // Clear graph history
        this.graphs?.clearData();
        
        // Reset simulation time to 0 (start of April 20, 1986)
        this.simulationSeconds = 0;
        this.updateTimeDisplay();
        
        // Reset time speed to 1x
        this.timeSpeed = 1;
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.classList.remove('active');
            if ((btn as HTMLElement).dataset.speed === '1') {
                btn.classList.add('active');
            }
        });
        
        try {
            this.state = await invoke<ReactorState>('reset_simulation');
            document.getElementById('alerts-list')!.innerHTML = '';
            
            // Reset control rod sliders to SHUTDOWN positions (all inserted = 0%):
            // All rods fully inserted for cold shutdown state
            const sliderValues = {
                'manual-rods': 0,
                'auto-rods': 0,
                'usp-rods': 0,
                'az-rods': 0
            };
            const labelIds = {
                'manual-rods': 'manual-rod-pos',
                'auto-rods': 'auto-rod-pos',
                'usp-rods': 'usp-rod-pos',
                'az-rods': 'az-rod-pos'
            };
            
            Object.entries(sliderValues).forEach(([sliderId, value]) => {
                const slider = document.getElementById(sliderId) as HTMLInputElement;
                if (slider) slider.value = String(value);
                const label = document.getElementById(labelIds[sliderId as keyof typeof labelIds]);
                if (label) label.textContent = `${value}%`;
            });
            
            // Reset visualization rod positions (all inserted = 0)
            this.visualization?.setRodPosition('RR' as ChannelType, 0.0);
            this.visualization?.setRodPosition('AR' as ChannelType, 0.0);
            this.visualization?.setRodPosition('LAR' as ChannelType, 0.0);
            this.visualization?.setRodPosition('USP' as ChannelType, 0.0);
            this.visualization?.setRodPosition('AZ' as ChannelType, 0.0);
            
            this.updateUI();
        } catch (e) {
            console.error('Reset failed:', e);
            // Still reset UI even if backend fails
            this.state = this.getMockState();
            document.getElementById('alerts-list')!.innerHTML = '';
            this.updateUI();
        }
    }
    
    private async moveRodGroup(rodType: string, position: number): Promise<void> {
        try {
            await invoke('move_rod_group', { rodType, position });
            await this.updateState();
        } catch (e) {
            console.error('Failed to move rods:', e);
        }
    }
    
    private async setTimeStep(dt: number): Promise<void> {
        try {
            await invoke('set_time_step', { dt });
        } catch (e) {
            console.error('Failed to set time step:', e);
        }
    }
    
    /**
     * Enable or disable automatic regulator (AR/LAR)
     */
    private async setAutoRegulatorEnabled(enabled: boolean): Promise<void> {
        try {
            await invoke('set_auto_regulator_enabled', { enabled });
            console.log(`[RBMK] Auto-regulator ${enabled ? 'enabled' : 'disabled'}`);
        } catch (e) {
            console.error('Failed to set auto-regulator enabled:', e);
        }
    }
    
    /**
     * Set target power for automatic regulator
     */
    private async setTargetPower(targetPercent: number): Promise<void> {
        try {
            await invoke('set_target_power', { targetPercent });
            console.log(`[RBMK] Target power set to ${targetPercent}%`);
        } catch (e) {
            console.error('Failed to set target power:', e);
        }
    }
    
    /**
     * Update auto-regulator display based on current state
     * Shows current AR rod position and updates slider/visualization
     */
    private updateAutoRegulatorDisplay(): void {
        if (!this.state) return;
        
        // Get AR rod positions from control rods data (we need to fetch this)
        // For now, we'll estimate based on the auto_regulator state
        // The actual position is managed by the backend
        
        // Update AR position display - this will be updated when we get control rod data
        const arPositionEl = document.getElementById('ar-position-display');
        if (arPositionEl) {
            // We'll update this from the control rods data in update3D
            // For now, show that it's being controlled automatically
            if (this.state.auto_regulator.enabled) {
                arPositionEl.style.color = '#4ade80';
            } else {
                arPositionEl.style.color = '#aaa';
            }
        }
        
        // Update AR enabled checkbox state
        const arEnabledCheckbox = document.getElementById('ar-enabled') as HTMLInputElement;
        if (arEnabledCheckbox && arEnabledCheckbox.checked !== this.state.auto_regulator.enabled) {
            arEnabledCheckbox.checked = this.state.auto_regulator.enabled;
        }
        
        // Update target power slider if it differs
        const targetPowerSlider = document.getElementById('target-power') as HTMLInputElement;
        const targetPowerValue = document.getElementById('target-power-value');
        if (targetPowerSlider && targetPowerValue) {
            const currentTarget = Math.round(this.state.auto_regulator.target_power);
            if (parseInt(targetPowerSlider.value) !== currentTarget) {
                targetPowerSlider.value = String(currentTarget);
                targetPowerValue.textContent = `${currentTarget}%`;
            }
        }
    }
    
    /**
     * Switch between 3D view, 2D projection, Heatmap, and Graphs view
     */
    private switchTab(tabId: '3d' | '2d' | 'heatmap' | 'graphs'): void {
        this.currentTab = tabId;
        
        // Update tab buttons
        document.querySelectorAll('.main-tab').forEach(tab => {
            tab.classList.remove('active');
            if ((tab as HTMLElement).dataset.tab === tabId) {
                tab.classList.add('active');
            }
        });
        
        // Show/hide containers
        const view3dContainer = document.getElementById('view-3d-container');
        const projection2dContainer = document.getElementById('projection-2d-container');
        const heatmapContainer = document.getElementById('heatmap-container');
        const graphsContainer = document.getElementById('graphs-container');
        
        // Hide all containers first
        view3dContainer?.classList.add('hidden');
        projection2dContainer?.classList.remove('active');
        heatmapContainer?.classList.remove('active');
        graphsContainer?.classList.remove('active');
        
        if (tabId === '3d') {
            view3dContainer?.classList.remove('hidden');
        } else if (tabId === '2d') {
            projection2dContainer?.classList.add('active');
            // Trigger resize to ensure canvas is properly sized
            this.projection2D?.render();
        } else if (tabId === 'heatmap') {
            heatmapContainer?.classList.add('active');
            // Trigger resize to ensure canvas is properly sized
            this.heatmap?.render();
        } else {
            graphsContainer?.classList.add('active');
            // Redraw graphs when switching to graphs tab
            this.graphs?.drawAllGraphs();
        }
    }
    
    // Real-time simulation methods
    
    /**
     * Get current simulation date/time as Date object
     */
    private getSimulationDate(): Date {
        const date = new Date(this.START_DATE.getTime());
        date.setSeconds(date.getSeconds() + Math.floor(this.simulationSeconds));
        return date;
    }
    
    /**
     * Format simulation time as HH:MM:SS
     */
    private formatSimulationTime(): string {
        const date = this.getSimulationDate();
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    /**
     * Format simulation date as DD.MM.YYYY
     */
    private formatSimulationDate(): string {
        const date = this.getSimulationDate();
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}.${month}.${year}`;
    }
    
    /**
     * Format elapsed time in human-readable format (days, hours, minutes, seconds)
     */
    private formatElapsedTime(): string {
        const totalSeconds = Math.floor(this.simulationSeconds);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        const parts: string[] = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0 || days > 0) parts.push(`${hours}h`);
        if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
        parts.push(`${seconds}s`);
        
        return parts.join(' ');
    }
    
    /**
     * Update the simulation time display
     */
    private updateTimeDisplay(): void {
        // Update time display (HH:MM:SS)
        const timeEl = document.getElementById('sim-time-display');
        if (timeEl) {
            timeEl.textContent = this.formatSimulationTime();
        }
        
        // Update date display (DD.MM.YYYY)
        const dateEl = document.getElementById('sim-date-display');
        if (dateEl) {
            dateEl.textContent = this.formatSimulationDate();
        }
        
        // Update elapsed time display
        const elapsedEl = document.getElementById('sim-elapsed-display');
        if (elapsedEl) {
            elapsedEl.textContent = this.formatElapsedTime();
        }
        
        // Update total seconds display
        const totalSecondsEl = document.getElementById('sim-total-seconds');
        if (totalSecondsEl) {
            totalSecondsEl.textContent = `${Math.floor(this.simulationSeconds).toLocaleString()} s`;
        }
    }
    
    /**
     * Set the time speed multiplier
     */
    private setTimeSpeed(speed: number): void {
        this.timeSpeed = speed;
        console.log(`[RBMK] Time speed set to ${speed}x`);
    }
    
    /**
     * Toggle play/pause state
     */
    private togglePlayPause(): void {
        if (this.isPlaying) {
            this.pauseSimulation();
        } else {
            this.startSimulation();
        }
    }
    
    /**
     * Start the real-time simulation loop
     */
    private startSimulation(): void {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.lastRealTime = performance.now();
        
        // Update button
        const btn = document.getElementById('btn-play-pause');
        if (btn) {
            btn.textContent = '⏸ Pause';
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-success');
        }
        
        // Update status indicator
        const statusEl = document.getElementById('status-indicator');
        if (statusEl) {
            statusEl.className = 'status-indicator status-running';
        }
        
        // Start the simulation loop
        this.simulationLoop();
    }
    
    /**
     * Pause the simulation
     */
    private pauseSimulation(): void {
        this.isPlaying = false;
        
        if (this.simulationLoopId !== null) {
            cancelAnimationFrame(this.simulationLoopId);
            this.simulationLoopId = null;
        }
        
        // Update button
        const btn = document.getElementById('btn-play-pause');
        if (btn) {
            btn.textContent = '▶ Play';
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
        }
        
        // Update status indicator
        const statusEl = document.getElementById('status-indicator');
        if (statusEl && !this.state?.scram_active) {
            statusEl.className = 'status-indicator status-paused';
        }
    }
    
    /**
     * Main simulation loop - runs in real-time
     */
    private simulationLoop(): void {
        if (!this.isPlaying) return;
        
        const currentTime = performance.now();
        const deltaRealTime = (currentTime - this.lastRealTime) / 1000; // Convert to seconds
        this.lastRealTime = currentTime;
        
        // Calculate simulation time advancement (scaled by timeSpeed for display)
        const simTimeDelta = deltaRealTime * this.timeSpeed;
        this.simulationSeconds += simTimeDelta;
        
        // No wrap-around - we track total elapsed time from April 20, 1986
        // The date/time formatting handles the conversion
        
        // Update time display
        this.updateTimeDisplay();
        
        // Run physics simulation - backend handles all timing calculations
        this.runPhysicsRealtime(deltaRealTime);
        
        // Schedule next frame
        this.simulationLoopId = requestAnimationFrame(() => this.simulationLoop());
    }
    
    /**
     * Run real-time physics simulation
     * Backend calculates how many steps to run based on delta time and time speed
     * Protected against overlapping calls to prevent lag accumulation
     */
    private async runPhysicsRealtime(deltaRealTime: number): Promise<void> {
        // Prevent overlapping physics calls
        if (this.isPhysicsRunning) {
            return;
        }
        
        this.isPhysicsRunning = true;
        
        try {
            // Backend handles all timing calculations
            // Use camelCase for Tauri 2.0 - it auto-converts to snake_case for Rust
            console.log(`[RBMK] Calling simulation_realtime: deltaRealTime=${deltaRealTime.toFixed(4)}, timeSpeed=${this.timeSpeed}`);
            const response = await invoke<SimulationResponse>('simulation_realtime', {
                deltaRealTime: deltaRealTime,
                timeSpeed: this.timeSpeed
            });
            this.state = response.state;
            this.updateUIFast();
        } catch (e) {
            console.error('[RBMK] Physics simulation error:', e);
            // Mock physics for development
            if (this.state) {
                this.state.time += deltaRealTime * this.timeSpeed;
                this.updateUIFast();
            }
        } finally {
            this.isPhysicsRunning = false;
        }
    }
    
    /**
     * Fast UI update - only updates critical values without 3D refresh
     * Used during continuous simulation to reduce overhead
     */
    private updateUIFast(): void {
        if (!this.state) return;
        
        // Helper to safely format numbers
        const safeFixed = (val: number | null | undefined, digits: number): string => {
            if (val === null || val === undefined || !Number.isFinite(val)) return '---';
            return val.toFixed(digits);
        };
        
        // Update only critical displays
        const powerEl = document.getElementById('power-value');
        if (powerEl) {
            powerEl.textContent = `${safeFixed(this.state.power_mw, 0)} MW (${safeFixed(this.state.power_percent, 1)}%)`;
            powerEl.className = `parameter-value ${this.getValueClass(this.state.power_percent ?? 0, 100, 110)}`;
        }
        
        const keffEl = document.getElementById('keff-value');
        if (keffEl) {
            keffEl.textContent = safeFixed(this.state.k_eff, 5);
        }
        
        const reactivityEl = document.getElementById('reactivity-value');
        if (reactivityEl) {
            reactivityEl.textContent = `${safeFixed((this.state.reactivity ?? 0) * 100, 3)}% (${safeFixed(this.state.reactivity_dollars, 2)}$)`;
        }
        
        const periodEl = document.getElementById('period-value');
        if (periodEl) {
            const period = this.state.period;
            if (period === null || period === undefined || !Number.isFinite(period) || Math.abs(period) > 1e10) {
                periodEl.textContent = '∞ s';
            } else {
                periodEl.textContent = `${period.toFixed(1)} s`;
            }
        }
        
        // Update temperatures
        const fuelTempEl = document.getElementById('fuel-temp');
        if (fuelTempEl) {
            fuelTempEl.textContent = `${safeFixed(this.state.avg_fuel_temp, 0)} K`;
            fuelTempEl.className = `parameter-value ${this.getValueClass(this.state.avg_fuel_temp ?? 0, 1000, 1200)}`;
        }
        
        const coolantTempEl = document.getElementById('coolant-temp');
        if (coolantTempEl) {
            coolantTempEl.textContent = `${safeFixed(this.state.avg_coolant_temp, 0)} K`;
        }
        
        const graphiteTempEl = document.getElementById('graphite-temp');
        if (graphiteTempEl) {
            graphiteTempEl.textContent = `${safeFixed(this.state.avg_graphite_temp, 0)} K`;
        }
        
        const voidEl = document.getElementById('void-fraction');
        if (voidEl) {
            voidEl.textContent = `${safeFixed(this.state.avg_coolant_void, 1)}%`;
        }
        
        // Update xenon and iodine
        const xenonEl = document.getElementById('xenon-value');
        if (xenonEl && this.state.xenon_135 != null && Number.isFinite(this.state.xenon_135)) {
            xenonEl.textContent = `${this.state.xenon_135.toExponential(2)} at/cm³`;
        }
        
        const iodineEl = document.getElementById('iodine-value');
        if (iodineEl && this.state.iodine_135 != null && Number.isFinite(this.state.iodine_135)) {
            iodineEl.textContent = `${this.state.iodine_135.toExponential(2)} at/cm³`;
        }
        
        // Update status indicator for SCRAM
        if (this.state.scram_active) {
            const statusEl = document.getElementById('status-indicator');
            if (statusEl) {
                statusEl.className = 'status-indicator status-scram';
            }
        }
        
        // Update auto-regulator display
        this.updateAutoRegulatorDisplay();
        
        // Update alerts (only if there are new ones)
        if (this.state.alerts.length > 0) {
            this.updateAlerts();
        }
        
        // Throttled 3D update
        this.update3D();
        
        // Update 2D projection
        this.update2DProjection();
        
        // Update graphs
        this.updateGraphs();
        
        // Check for steam explosion - show "Connection Lost" overlay
        this.checkExplosionState();
    }
    
    /**
     * Check if a steam explosion has occurred and show the "Connection Lost" overlay
     * This is based on physics simulation - not hardcoded conditions
     */
    private checkExplosionState(): void {
        if (!this.state || !this.visualization) return;
        
        // If explosion occurred and overlay not yet shown, show it
        if (this.state.explosion_occurred && !this.visualization.isShowingConnectionLost()) {
            console.log('[RBMK] Steam explosion detected! Showing connection lost overlay.');
            this.visualization.showConnectionLost(this.state.explosion_time);
            
            // Pause the simulation - the reactor is destroyed
            this.pauseSimulation();
            
            // Add final alert
            const alertsList = document.getElementById('alerts-list');
            if (alertsList) {
                const alertEl = document.createElement('div');
                alertEl.className = 'alert alert-critical';
                alertEl.style.cssText = 'background: #ff0000; color: white; font-weight: bold;';
                alertEl.textContent = `[${this.formatSimulationTime()}] ☢ CATASTROPHIC FAILURE - ALL MONITORING SYSTEMS OFFLINE`;
                alertsList.insertBefore(alertEl, alertsList.firstChild);
            }
        }
    }
    
    // Mock data for development without Tauri backend
    private getMockState(): ReactorState {
        return {
            time: 0,
            dt: 0.1,
            power_mw: 0,           // Shutdown - no power
            power_percent: 0,      // Shutdown - 0%
            neutron_population: 1e-6, // Very low neutron source
            precursors: 0,
            k_eff: 0.95,           // Subcritical
            reactivity: -0.05,     // Negative reactivity
            reactivity_dollars: -7.7,
            period: Infinity,
            iodine_135: 0,         // No iodine - fresh start
            xenon_135: 0,          // No xenon - fresh start
            xenon_reactivity: 0,   // No xenon poisoning
            avg_fuel_temp: 300,    // Cold - room temperature
            avg_coolant_temp: 300, // Cold - room temperature
            avg_graphite_temp: 300, // Cold - room temperature
            avg_coolant_void: 0,
            scram_active: false,
            scram_time: 0,
            auto_regulator: {
                enabled: false,       // AR disabled at startup
                target_power: 100.0,
                kp: 0.002,
                ki: 0.0001,
                kd: 0.001,
                integral_error: 0.0,
                last_error: 0.0,
                rod_speed: 0.01,
                deadband: 0.5,
            },
            axial_flux: Array(50).fill(0), // Zero flux - shutdown
            alerts: [],
            explosion_occurred: false,
            explosion_time: 0,
        };
    }
    
    private getMockData(): Reactor3DData {
        const channels: any[] = [];
        const rods: any[] = [];
        
        // Generate mock fuel channels (cold shutdown state)
        for (let i = 0; i < 100; i++) {
            const angle = (i / 100) * Math.PI * 2;
            const radius = 300 + Math.random() * 200;
            channels.push({
                id: i,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                fuel_temp: 300,      // Cold - room temperature
                coolant_temp: 300,   // Cold - room temperature
                coolant_void: 0,
                neutron_flux: 0,     // No flux - shutdown
                burnup: 0,           // Fresh fuel
            });
        }
        
        // Generate mock control rods - ALL INSERTED for shutdown
        const rodTypes = ['Emergency', 'Automatic', 'Shortened', 'Manual'];
        for (let i = 0; i < 40; i++) {
            const angle = (i / 40) * Math.PI * 2;
            const radius = 350 + (i % 2) * 100;
            const rodType = rodTypes[i % 4];
            rods.push({
                id: i,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                position: 0.0,  // All rods fully inserted for shutdown
                rod_type: rodType,
                worth: rodType === 'Emergency' ? 0.005 : 0.001,
            });
        }
        
        return {
            core_height: 700,
            core_radius: 593,
            fuel_channels: channels,
            control_rods: rods,
            axial_flux: Array(50).fill(0), // Zero flux - shutdown
            power_distribution: Array(20).fill(Array(20).fill(0)), // Zero power
        };
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new RBMKSimulator();
});
