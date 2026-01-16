/**
 * RBMK-1000 Reactor Simulator - Main Entry Point
 * Integrates Tauri backend with Babylon.js 3D visualization
 */

import { invoke } from '@tauri-apps/api/core';
import { ReactorVisualization, Reactor3DData, ControlRod } from './visualization';
import { ChannelType } from './rbmk_core_layout';
import { ReactorGraphs } from './graphs';

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
    private state: ReactorState | null = null;
    
    // Current view tab
    private currentTab: '3d' | 'graphs' = '3d';
    
    // Real-time simulation properties
    private simulationTime: number = 12 * 3600; // Start at 12:00:00 (in seconds from midnight)
    private timeSpeed: number = 1; // Time multiplier (0.1, 0.2, 0.5, 1, 2, 5, 10)
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
        // Initialize 3D visualization
        const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
        if (canvas) {
            this.visualization = new ReactorVisualization(canvas);
            
            // Get initial 3D data and initialize reactor geometry
            try {
                const data = await invoke<Reactor3DData>('get_3d_data');
                this.visualization.initializeReactor(data);
            } catch (e) {
                console.error('Failed to get 3D data:', e);
                // Use mock data for development
                this.visualization.initializeReactor(this.getMockData());
            }
            
            // Set initial rod positions in 3D visualization to match startup defaults
            // AZ (Emergency): 100% extracted - ready to drop for safety
            // RR (Manual): 15% - main control rods for startup
            // AR/LAR (Automatic): 25% - automatic regulation with headroom
            // USP (Shortened): 55% - axial flux shaping
            this.visualization.setRodPosition('RR' as ChannelType, 0.15);
            this.visualization.setRodPosition('AR' as ChannelType, 0.25);
            this.visualization.setRodPosition('LAR' as ChannelType, 0.25);
            this.visualization.setRodPosition('USP' as ChannelType, 0.55);
            this.visualization.setRodPosition('AZ' as ChannelType, 1.0);
        }
        
        // Initialize graphs module
        this.graphs = new ReactorGraphs();
        this.graphs.initialize();
        
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
                const tabId = (e.target as HTMLElement).dataset.tab as '3d' | 'graphs';
                this.switchTab(tabId);
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
        } catch (e) {
            // Use mock data
            const mockData = this.getMockData();
            this.visualization.updateState(mockData, this.state.power_percent);
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
        
        // Reset simulation time to 12:00:00
        this.simulationTime = 12 * 3600;
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
            
            // Reset control rod sliders to realistic startup positions:
            // AZ (Emergency): 100% extracted - ready to drop for safety
            // RR (Manual): 15% - main control rods for startup
            // AR/LAR (Automatic): 25% - automatic regulation with headroom
            // USP (Shortened): 55% - axial flux shaping
            const sliderValues = {
                'manual-rods': 15,
                'auto-rods': 25,
                'usp-rods': 55,
                'az-rods': 100
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
            
            // Reset visualization rod positions
            this.visualization?.setRodPosition('RR' as ChannelType, 0.15);
            this.visualization?.setRodPosition('AR' as ChannelType, 0.25);
            this.visualization?.setRodPosition('LAR' as ChannelType, 0.25);
            this.visualization?.setRodPosition('USP' as ChannelType, 0.55);
            this.visualization?.setRodPosition('AZ' as ChannelType, 1.0);
            
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
     * Switch between 3D view and Graphs view
     */
    private switchTab(tabId: '3d' | 'graphs'): void {
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
        const graphsContainer = document.getElementById('graphs-container');
        
        if (tabId === '3d') {
            view3dContainer?.classList.remove('hidden');
            graphsContainer?.classList.remove('active');
        } else {
            view3dContainer?.classList.add('hidden');
            graphsContainer?.classList.add('active');
            // Redraw graphs when switching to graphs tab
            this.graphs?.drawAllGraphs();
        }
    }
    
    // Real-time simulation methods
    
    /**
     * Format simulation time as HH:MM:SS
     */
    private formatSimulationTime(): string {
        const totalSeconds = Math.floor(this.simulationTime);
        const hours = Math.floor(totalSeconds / 3600) % 24;
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    /**
     * Update the simulation time display
     */
    private updateTimeDisplay(): void {
        const timeEl = document.getElementById('sim-time-display');
        if (timeEl) {
            timeEl.textContent = this.formatSimulationTime();
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
        this.simulationTime += simTimeDelta;
        
        // Handle day wrap-around (24 hours = 86400 seconds)
        if (this.simulationTime >= 86400) {
            this.simulationTime -= 86400;
        }
        
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
        
        // Update status indicator for SCRAM
        if (this.state.scram_active) {
            const statusEl = document.getElementById('status-indicator');
            if (statusEl) {
                statusEl.className = 'status-indicator status-scram';
            }
        }
        
        // Update alerts (only if there are new ones)
        if (this.state.alerts.length > 0) {
            this.updateAlerts();
        }
        
        // Throttled 3D update
        this.update3D();
        
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
            power_mw: 3200,
            power_percent: 100,
            neutron_population: 1.0,
            precursors: 0.0065,
            k_eff: 1.0,
            reactivity: 0,
            reactivity_dollars: 0,
            period: Infinity,
            iodine_135: 1e15,
            xenon_135: 3e15,
            xenon_reactivity: -0.03,
            avg_fuel_temp: 900,       // Equilibrium at 100% power
            avg_coolant_temp: 550,    // Below saturation (558K)
            avg_graphite_temp: 650,   // Equilibrium at 100% power
            avg_coolant_void: 0,
            scram_active: false,
            scram_time: 0,
            axial_flux: Array(50).fill(0).map((_, i) =>
                Math.cos(Math.PI * (i - 25) / 50) * (i > 5 && i < 45 ? 1 : 0)
            ),
            alerts: [],
            explosion_occurred: false,
            explosion_time: 0,
        };
    }
    
    private getMockData(): Reactor3DData {
        const channels: any[] = [];
        const rods: any[] = [];
        
        // Generate mock fuel channels
        for (let i = 0; i < 100; i++) {
            const angle = (i / 100) * Math.PI * 2;
            const radius = 300 + Math.random() * 200;
            channels.push({
                id: i,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                fuel_temp: 800,
                coolant_temp: 560,
                coolant_void: 0,
                neutron_flux: 0.5 + Math.random() * 0.5,
                burnup: 10,
            });
        }
        
        // Generate mock control rods with different types and realistic startup positions
        // AZ (Emergency): 100% extracted - ready to drop for safety
        // RR (Manual): 15% - main control rods for startup
        // AR/LAR (Automatic): 25% - automatic regulation with headroom
        // USP (Shortened): 55% - axial flux shaping
        const rodTypes = ['Emergency', 'Automatic', 'Shortened', 'Manual'];
        const rodPositions: Record<string, number> = {
            'Emergency': 1.0,   // AZ - fully extracted
            'Automatic': 0.25,  // AR/LAR
            'Shortened': 0.55,  // USP
            'Manual': 0.15      // RR
        };
        for (let i = 0; i < 40; i++) {
            const angle = (i / 40) * Math.PI * 2;
            const radius = 350 + (i % 2) * 100;
            const rodType = rodTypes[i % 4];
            rods.push({
                id: i,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                position: rodPositions[rodType],
                rod_type: rodType,
                worth: rodType === 'Emergency' ? 0.005 : 0.001,
            });
        }
        
        return {
            core_height: 700,
            core_radius: 593,
            fuel_channels: channels,
            control_rods: rods,
            axial_flux: Array(50).fill(0).map((_, i) => 
                Math.cos(Math.PI * (i - 25) / 50) * (i > 5 && i < 45 ? 1 : 0)
            ),
            power_distribution: Array(20).fill(Array(20).fill(0.5)),
        };
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new RBMKSimulator();
});
