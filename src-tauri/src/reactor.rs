//! RBMK Reactor Simulation State
//!
//! This module contains the reactor state and simulation logic.
//! All physics calculations are delegated to Fortran via FFI.
//!
//! The reactor core consists of 1661 fuel channels (TK cells) arranged
//! according to the OPB-82 layout configuration. Currently, all channels
//! have synchronized parameters (no spatial diffusion coupling yet).

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::fs;
use std::collections::HashMap;

use crate::fortran_ffi;

/// Layout configuration structures for loading OPB-82 layout
#[derive(Debug, Clone, Deserialize)]
struct LayoutConfig {
    metadata: LayoutMetadata,
    cells: HashMap<String, Vec<CellConfig>>,
}

#[derive(Debug, Clone, Deserialize)]
struct LayoutMetadata {
    total_cells: usize,
    grid_size: GridSize,
}

#[derive(Debug, Clone, Deserialize)]
struct GridSize {
    width: usize,
    height: usize,
}

#[derive(Debug, Clone, Deserialize)]
struct CellConfig {
    grid_x: i32,
    grid_y: i32,
    #[allow(dead_code)]
    original_grid_x: i32,
    #[allow(dead_code)]
    original_grid_y: i32,
    #[allow(dead_code)]
    pixel_x: i32,
    #[allow(dead_code)]
    pixel_y: i32,
    #[allow(dead_code)]
    area: i32,
}

/// Grid spacing in cm (graphite block size)
const GRID_SPACING_CM: f64 = 25.0;

/// Grid center (48x48 grid, center at 24)
const GRID_CENTER: f64 = 24.0;

/// Load fuel channel positions from the OPB-82 layout config
fn load_fuel_channels_from_config() -> Vec<FuelChannel> {
    // Try to load from config file
    let config_paths = [
        "config/opb82_layout.json",
        "../config/opb82_layout.json",
        "ui/public/config/opb82_layout.json",
    ];
    
    for path in &config_paths {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(config) = serde_json::from_str::<LayoutConfig>(&content) {
                return create_channels_from_config(&config);
            }
        }
    }
    
    // Fallback: generate default circular grid if config not found
    eprintln!("[reactor] Warning: Could not load layout config, using fallback circular grid");
    create_fallback_channels()
}

/// Default values for RBMK-1000 fuel channel parameters (cold shutdown state)
mod channel_defaults {
    // Thermal parameters (cold shutdown)
    pub const FUEL_TEMP_K: f64 = 300.0;         // Room temperature
    pub const COOLANT_TEMP_K: f64 = 300.0;      // Room temperature
    pub const GRAPHITE_TEMP_K: f64 = 300.0;     // Room temperature
    pub const COOLANT_VOID_PERCENT: f64 = 0.0;  // No void
    
    // Thermal-hydraulic parameters (nominal values, but reactor is shutdown)
    pub const PRESSURE_MPA: f64 = 7.0;          // Nominal operating pressure
    pub const FLOW_RATE_KG_S: f64 = 5.5;        // Nominal flow rate per channel
    pub const INLET_TEMP_K: f64 = 543.0;        // Nominal inlet temp (270°C)
    pub const OUTLET_TEMP_K: f64 = 557.0;       // Nominal outlet temp (284°C)
    
    // Neutronics (shutdown)
    pub const NEUTRON_FLUX: f64 = 0.0;          // No flux - shutdown
    pub const POWER_DENSITY_MW_M3: f64 = 0.0;   // No power - shutdown
    pub const LOCAL_POWER_MW: f64 = 0.0;        // No power - shutdown
    
    // Xenon/Iodine (fresh fuel, no history)
    pub const IODINE_135: f64 = 0.0;            // No iodine
    pub const XENON_135: f64 = 0.0;             // No xenon
    
    // Fuel state
    pub const BURNUP_MWD_KGU: f64 = 0.0;        // Fresh fuel
    pub const ENRICHMENT_PERCENT: f64 = 2.0;   // Standard RBMK enrichment
    
    // Local reactivity
    pub const LOCAL_REACTIVITY: f64 = 0.0;      // No local contribution
}

/// Create fuel channels from loaded config (TK cells only)
fn create_channels_from_config(config: &LayoutConfig) -> Vec<FuelChannel> {
    let mut fuel_channels = Vec::new();
    
    // Get TK (fuel channel) cells
    if let Some(tk_cells) = config.cells.get("TK") {
        for (id, cell) in tk_cells.iter().enumerate() {
            // Convert grid position to cm from center
            // Grid is 48x48, center at (24, 24)
            // Each cell is 25cm
            let x = (cell.grid_x as f64 - GRID_CENTER + 0.5) * GRID_SPACING_CM;
            let y = (cell.grid_y as f64 - GRID_CENTER + 0.5) * GRID_SPACING_CM;
            
            fuel_channels.push(FuelChannel {
                // Identification and position
                id,
                grid_x: cell.grid_x,
                grid_y: cell.grid_y,
                x,
                y,
                
                // Thermal parameters (cold shutdown)
                fuel_temp: channel_defaults::FUEL_TEMP_K,
                coolant_temp: channel_defaults::COOLANT_TEMP_K,
                graphite_temp: channel_defaults::GRAPHITE_TEMP_K,
                coolant_void: channel_defaults::COOLANT_VOID_PERCENT,
                
                // Thermal-hydraulic parameters
                pressure: channel_defaults::PRESSURE_MPA,
                flow_rate: channel_defaults::FLOW_RATE_KG_S,
                inlet_temp: channel_defaults::INLET_TEMP_K,
                outlet_temp: channel_defaults::OUTLET_TEMP_K,
                
                // Neutronics (shutdown)
                neutron_flux: channel_defaults::NEUTRON_FLUX,
                power_density: channel_defaults::POWER_DENSITY_MW_M3,
                local_power: channel_defaults::LOCAL_POWER_MW,
                
                // Xenon/Iodine (fresh fuel)
                iodine_135: channel_defaults::IODINE_135,
                xenon_135: channel_defaults::XENON_135,
                
                // Fuel state
                burnup: channel_defaults::BURNUP_MWD_KGU,
                enrichment: channel_defaults::ENRICHMENT_PERCENT,
                
                // Control rod (will be assigned later based on layout)
                has_control_rod: false,
                control_rod_id: None,
                local_rod_position: 1.0,  // No rod = effectively withdrawn
                
                // Neighbors (will be computed later for diffusion)
                neighbors: Vec::new(),
                
                // Local reactivity
                local_reactivity: channel_defaults::LOCAL_REACTIVITY,
            });
        }
    }
    
    println!("[reactor] Loaded {} fuel channels from config", fuel_channels.len());
    fuel_channels
}

/// Fallback: create simplified circular grid if config not found
fn create_fallback_channels() -> Vec<FuelChannel> {
    let mut fuel_channels = Vec::new();
    let grid_size = 41;
    let spacing = 2.0 * constants::CORE_RADIUS_CM / (grid_size as f64);
    
    let mut id = 0;
    for i in 0..grid_size {
        for j in 0..grid_size {
            let x = -constants::CORE_RADIUS_CM + spacing * (i as f64 + 0.5);
            let y = -constants::CORE_RADIUS_CM + spacing * (j as f64 + 0.5);
            
            if x*x + y*y <= constants::CORE_RADIUS_CM * constants::CORE_RADIUS_CM {
                fuel_channels.push(FuelChannel {
                    // Identification and position
                    id,
                    grid_x: i as i32,
                    grid_y: j as i32,
                    x,
                    y,
                    
                    // Thermal parameters (cold shutdown)
                    fuel_temp: channel_defaults::FUEL_TEMP_K,
                    coolant_temp: channel_defaults::COOLANT_TEMP_K,
                    graphite_temp: channel_defaults::GRAPHITE_TEMP_K,
                    coolant_void: channel_defaults::COOLANT_VOID_PERCENT,
                    
                    // Thermal-hydraulic parameters
                    pressure: channel_defaults::PRESSURE_MPA,
                    flow_rate: channel_defaults::FLOW_RATE_KG_S,
                    inlet_temp: channel_defaults::INLET_TEMP_K,
                    outlet_temp: channel_defaults::OUTLET_TEMP_K,
                    
                    // Neutronics (shutdown)
                    neutron_flux: channel_defaults::NEUTRON_FLUX,
                    power_density: channel_defaults::POWER_DENSITY_MW_M3,
                    local_power: channel_defaults::LOCAL_POWER_MW,
                    
                    // Xenon/Iodine (fresh fuel)
                    iodine_135: channel_defaults::IODINE_135,
                    xenon_135: channel_defaults::XENON_135,
                    
                    // Fuel state
                    burnup: channel_defaults::BURNUP_MWD_KGU,
                    enrichment: channel_defaults::ENRICHMENT_PERCENT,
                    
                    // Control rod (will be assigned later)
                    has_control_rod: false,
                    control_rod_id: None,
                    local_rod_position: 1.0,
                    
                    // Neighbors (will be computed later)
                    neighbors: Vec::new(),
                    
                    // Local reactivity
                    local_reactivity: channel_defaults::LOCAL_REACTIVITY,
                });
                id += 1;
            }
        }
    }
    
    fuel_channels
}

/// Physical constants for RBMK-1000 (from Fortran)
pub mod constants {
    pub const NOMINAL_POWER_MW: f64 = 3200.0;
    pub const NUM_FUEL_CHANNELS: usize = 1661;
    pub const CORE_HEIGHT_CM: f64 = 700.0;
    pub const CORE_RADIUS_CM: f64 = 593.0;
    pub const NUM_CONTROL_RODS: usize = 211;
    pub const BETA_EFF: f64 = 0.0065;
    pub const NEUTRON_LIFETIME: f64 = 1.0e-3; // seconds
}

/// State of a single fuel channel with independent parameters
/// Each channel now has its own physics state for full 2D spatial simulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuelChannel {
    // Identification and position
    pub id: usize,
    pub grid_x: i32,  // Grid position (0-47)
    pub grid_y: i32,  // Grid position (0-47)
    pub x: f64,       // Position in core [cm] from center
    pub y: f64,       // Position in core [cm] from center
    
    // Thermal parameters (independent per channel)
    pub fuel_temp: f64,      // Fuel temperature [K]
    pub coolant_temp: f64,   // Coolant temperature [K]
    pub graphite_temp: f64,  // Graphite moderator temperature [K]
    pub coolant_void: f64,   // Void fraction [%]
    
    // Thermal-hydraulic parameters (independent per channel)
    pub pressure: f64,       // Coolant pressure [MPa]
    pub flow_rate: f64,      // Coolant mass flow rate [kg/s]
    pub inlet_temp: f64,     // Coolant inlet temperature [K]
    pub outlet_temp: f64,    // Coolant outlet temperature [K]
    
    // Neutronics (independent per channel)
    pub neutron_flux: f64,   // Local neutron flux [n/cm²/s]
    pub power_density: f64,  // Local power density [MW/m³]
    pub local_power: f64,    // Channel thermal power [MW]
    
    // Xenon/Iodine dynamics (independent per channel)
    pub iodine_135: f64,     // I-135 concentration [atoms/cm³]
    pub xenon_135: f64,      // Xe-135 concentration [atoms/cm³]
    
    // Fuel state
    pub burnup: f64,         // Burnup [MWd/kgU]
    pub enrichment: f64,     // U-235 enrichment [%]
    
    // Local control rod (if present in this cell)
    pub has_control_rod: bool,
    pub control_rod_id: Option<usize>,  // ID of control rod if present
    pub local_rod_position: f64,        // 0.0 = inserted, 1.0 = withdrawn
    
    // Neighbor indices for 2D diffusion coupling
    pub neighbors: Vec<usize>,  // Indices of neighboring channels
    
    // Local reactivity contributions
    pub local_reactivity: f64,  // Local reactivity contribution [Δk/k]
}

/// State of a control rod
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlRod {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub position: f64,       // 0.0 = fully inserted, 1.0 = fully withdrawn
    pub rod_type: RodType,
    pub worth: f64,          // [Δk/k]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RodType {
    Manual,      // Manual control rods
    Automatic,   // Automatic power regulators
    Shortened,   // Shortened absorber rods (USP)
    Emergency,   // Emergency protection (AZ)
}

/// Automatic power regulator settings (AR/LAR)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoRegulatorSettings {
    pub enabled: bool,           // Is automatic regulation active
    pub target_power: f64,       // Target power in % of nominal
    pub kp: f64,                 // Proportional gain
    pub ki: f64,                 // Integral gain
    pub kd: f64,                 // Derivative gain
    pub integral_error: f64,     // Accumulated integral error
    pub last_error: f64,         // Previous error for derivative
    pub rod_speed: f64,          // Max rod movement speed [fraction/s]
    pub deadband: f64,           // Power error deadband [%]
}

impl Default for AutoRegulatorSettings {
    fn default() -> Self {
        Self {
            enabled: false,       // AR is disabled at startup (reactor is shutdown)
            target_power: 100.0,  // Target 100% power (when enabled)
            kp: 0.002,            // Proportional gain (conservative)
            ki: 0.0001,           // Integral gain (slow correction)
            kd: 0.001,            // Derivative gain (damping)
            integral_error: 0.0,
            last_error: 0.0,
            rod_speed: 0.01,      // 1% per second max speed
            deadband: 0.5,        // ±0.5% deadband
        }
    }
}

/// Complete reactor state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactorState {
    // Time
    pub time: f64,           // Simulation time [s]
    pub dt: f64,             // Time step [s]
    
    // Power and neutronics
    pub power_mw: f64,       // Thermal power [MW]
    pub power_percent: f64,  // Power as % of nominal
    pub neutron_population: f64,
    pub precursors: f64,     // Delayed neutron precursors
    pub k_eff: f64,          // Effective multiplication factor
    pub reactivity: f64,     // Total reactivity [Δk/k]
    pub reactivity_dollars: f64, // Reactivity in dollars
    pub period: f64,         // Reactor period [s]
    
    // Xenon poisoning
    pub iodine_135: f64,     // I-135 concentration [atoms/cm³]
    pub xenon_135: f64,      // Xe-135 concentration [atoms/cm³]
    pub xenon_reactivity: f64, // Reactivity from Xe-135 [Δk/k]
    
    // Temperatures
    pub avg_fuel_temp: f64,      // [K]
    pub avg_coolant_temp: f64,   // [K]
    pub avg_graphite_temp: f64,  // [K]
    pub avg_coolant_void: f64,   // [%]
    
    // Control
    pub scram_active: bool,
    pub scram_time: f64,     // Time since SCRAM [s]
    
    // Automatic regulator (AR/LAR)
    pub auto_regulator: AutoRegulatorSettings,
    
    // Axial flux distribution
    pub axial_flux: Vec<f64>,
    
    // Alerts
    pub alerts: Vec<String>,
    
    // Steam explosion state
    pub explosion_occurred: bool,
    pub explosion_time: f64,  // Time when explosion occurred [s]
    
    // Smoothed reactivity for numerical stability
    #[serde(skip)]
    pub smoothed_reactivity: f64,
}

impl Default for ReactorState {
    fn default() -> Self {
        // Create flat flux distribution (reactor is shutdown)
        let axial_flux: Vec<f64> = (0..50)
            .map(|_| 0.0) // Zero flux - reactor is shutdown
            .collect();
        
        Self {
            time: 0.0,
            dt: 0.1,
            power_mw: 0.0,           // Shutdown - no power
            power_percent: 0.0,      // Shutdown - 0%
            neutron_population: 1e-6, // Very low neutron source (subcritical)
            precursors: 0.0,         // No precursors - fresh start
            k_eff: 0.95,             // Subcritical
            reactivity: -0.05,       // Negative reactivity (subcritical)
            reactivity_dollars: -7.7, // About -7.7$ (deeply subcritical)
            period: f64::INFINITY,
            iodine_135: 0.0,         // No iodine - fresh start, no xenon pit
            xenon_135: 0.0,          // No xenon - fresh start, no xenon pit
            xenon_reactivity: 0.0,   // No xenon poisoning
            avg_fuel_temp: 300.0,    // Cold - room temperature
            avg_coolant_temp: 300.0, // Cold - room temperature
            avg_graphite_temp: 300.0, // Cold - room temperature
            avg_coolant_void: 0.0,
            scram_active: false,
            scram_time: 0.0,
            auto_regulator: AutoRegulatorSettings::default(),
            axial_flux,
            alerts: Vec::new(),
            explosion_occurred: false,
            explosion_time: 0.0,
            smoothed_reactivity: -0.05,
        }
    }
}

/// Reactor simulation engine
pub struct ReactorSimulator {
    pub state: Mutex<ReactorState>,
    pub control_rods: Mutex<Vec<ControlRod>>,
    pub fuel_channels: Mutex<Vec<FuelChannel>>,
    pub running: Mutex<bool>,
}

impl Default for ReactorSimulator {
    fn default() -> Self {
        Self::new()
    }
}

impl ReactorSimulator {
    pub fn new() -> Self {
        let mut control_rods = Vec::new();
        
        // Initialize control rods with SHUTDOWN positions (all inserted)
        // RBMK-1000 has 211 control rods total:
        // - 24 AZ (emergency) rods
        // - 24 AR/LAR (automatic regulator) rods
        // - 24 USP (shortened absorber) rods
        // - 139 RR (manual) rods
        for i in 0..constants::NUM_CONTROL_RODS {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (constants::NUM_CONTROL_RODS as f64);
            let radius = constants::CORE_RADIUS_CM * 0.7;
            
            let (rod_type, position) = if i < 24 {
                (RodType::Emergency, 0.0)   // AZ - fully inserted (shutdown)
            } else if i < 48 {
                (RodType::Automatic, 0.0)   // AR/LAR - fully inserted (shutdown)
            } else if i < 72 {
                (RodType::Shortened, 0.0)   // USP - fully inserted (shutdown)
            } else {
                (RodType::Manual, 0.0)      // RR - fully inserted (shutdown)
            };
            
            // Rod worth varies by type - increased for proper reactivity control
            // Total worth should be able to compensate BASE_REACTIVITY (0.08) + margin
            let worth = match rod_type {
                RodType::Emergency => 0.003,   // 24 rods × 0.003 = 0.072 total
                RodType::Automatic => 0.0015,  // 24 rods × 0.0015 = 0.036 total
                RodType::Shortened => 0.001,   // 24 rods × 0.001 = 0.024 total
                RodType::Manual => 0.0008,     // 139 rods × 0.0008 = 0.111 total
            };
            
            control_rods.push(ControlRod {
                id: i,
                x: radius * angle.cos(),
                y: radius * angle.sin(),
                position,
                rod_type,
                worth,
            });
        }
        
        // Load fuel channels from OPB-82 layout config (1661 TK cells)
        let fuel_channels = load_fuel_channels_from_config();
        
        Self {
            state: Mutex::new(ReactorState::default()),
            control_rods: Mutex::new(control_rods),
            fuel_channels: Mutex::new(fuel_channels),
            running: Mutex::new(false),
        }
    }
    
    /// Calculate total control rod worth (how much is inserted)
    fn calculate_total_rod_worth(&self) -> f64 {
        let control_rods = self.control_rods.lock().unwrap();
        control_rods.iter()
            .map(|rod| {
                let insertion = 1.0 - rod.position;
                rod.worth * insertion
            })
            .sum()
    }
    
    /// Perform one simulation step using Fortran physics
    pub fn step(&self) {
        // First, run automatic regulator if enabled (before physics step)
        // This needs to be done with separate locks to avoid deadlock
        let (ar_enabled, ar_target, ar_settings, current_power, dt, scram_active) = {
            let state = self.state.lock().unwrap();
            (
                state.auto_regulator.enabled,
                state.auto_regulator.target_power,
                state.auto_regulator.clone(),
                state.power_percent,
                state.dt,
                state.scram_active,
            )
        };
        
        // Run automatic regulator (AR/LAR) - PID control for power
        if ar_enabled && !scram_active {
            let rod_adjustment = self.calculate_ar_adjustment(&ar_settings, current_power, dt);
            if rod_adjustment.abs() > 1e-6 {
                self.adjust_automatic_rods(rod_adjustment);
            }
        }
        
        let mut state = self.state.lock().unwrap();
        
        state.alerts.clear();
        let dt = state.dt;
        
        // Calculate total control rod worth
        let total_rod_worth = self.calculate_total_rod_worth();
        
        // Handle SCRAM timing
        if state.scram_active {
            state.scram_time += dt;
        }
        
        // Call Fortran simulation step
        let result = fortran_ffi::simulation_step(
            dt,
            state.neutron_population,
            state.precursors,
            state.avg_fuel_temp,
            state.avg_coolant_temp,
            state.avg_graphite_temp,
            state.avg_coolant_void,
            state.iodine_135,
            state.xenon_135,
            total_rod_worth,
            state.smoothed_reactivity,
            state.scram_active,
        );
        
        // Update state from Fortran results
        state.neutron_population = result.neutron_population;
        state.precursors = result.precursors;
        state.avg_fuel_temp = result.fuel_temp;
        state.avg_coolant_temp = result.coolant_temp;
        state.avg_graphite_temp = result.graphite_temp;
        state.avg_coolant_void = result.coolant_void;
        state.iodine_135 = result.iodine_135;
        state.xenon_135 = result.xenon_135;
        state.smoothed_reactivity = result.reactivity;
        state.reactivity = result.reactivity;
        state.k_eff = result.k_eff;
        state.power_mw = result.power_mw;
        state.power_percent = result.power_percent;
        state.period = if result.period > 1.0e20 { f64::INFINITY } else { result.period };
        state.reactivity_dollars = state.reactivity / constants::BETA_EFF;
        
        // Update automatic regulator state (PID integral/derivative terms)
        if state.auto_regulator.enabled && !state.scram_active {
            let error = state.auto_regulator.target_power - state.power_percent;
            
            // Only accumulate integral if error is outside deadband
            if error.abs() > state.auto_regulator.deadband {
                // Anti-windup: limit integral accumulation
                let max_integral = 50.0; // Limit integral term
                state.auto_regulator.integral_error =
                    (state.auto_regulator.integral_error + error * dt).clamp(-max_integral, max_integral);
            }
            
            state.auto_regulator.last_error = error;
        }
        
        // Update axial flux distribution using Fortran
        state.axial_flux = fortran_ffi::update_axial_flux(50, state.neutron_population);
        
        // Process alert flags from Fortran
        let flags = result.alert_flags;
        if flags & fortran_ffi::ALERT_POWER_HIGH != 0 {
            state.alerts.push("WARNING: Power exceeds 110% nominal!".to_string());
        }
        if flags & fortran_ffi::ALERT_REACTIVITY_HIGH != 0 {
            state.alerts.push("WARNING: Reactivity exceeds 0.5$!".to_string());
        }
        if flags & fortran_ffi::ALERT_PROMPT_CRITICAL != 0 {
            state.alerts.push("CRITICAL: Prompt critical condition!".to_string());
        }
        if flags & fortran_ffi::ALERT_FUEL_TEMP_HIGH != 0 {
            state.alerts.push("WARNING: Fuel temperature exceeds limit!".to_string());
        }
        if flags & fortran_ffi::ALERT_VOID_HIGH != 0 {
            state.alerts.push("WARNING: High void fraction - positive reactivity feedback!".to_string());
        }
        if flags & fortran_ffi::ALERT_SHORT_PERIOD != 0 {
            let period = state.period;
            state.alerts.push(format!("WARNING: Short reactor period: {:.1}s", period));
        }
        
        // Check for explosion (from Fortran)
        if !state.explosion_occurred && result.explosion_severity >= 1.0 {
            state.explosion_occurred = true;
            state.explosion_time = state.time;
            state.alerts.push("*** STEAM EXPLOSION - CORE DESTRUCTION ***".to_string());
        }
        
        // Update time
        state.time += dt;
    }
    
    /// Calculate automatic regulator (AR) rod adjustment using PID control
    /// Returns the position change for automatic rods (positive = withdraw, negative = insert)
    fn calculate_ar_adjustment(&self, settings: &AutoRegulatorSettings, current_power: f64, dt: f64) -> f64 {
        let error = settings.target_power - current_power;
        
        // If within deadband, no adjustment needed
        if error.abs() <= settings.deadband {
            return 0.0;
        }
        
        // PID control calculation
        // P: Proportional to current error
        let p_term = settings.kp * error;
        
        // I: Integral of error over time (already accumulated in settings)
        let i_term = settings.ki * settings.integral_error;
        
        // D: Rate of change of error
        let d_term = if dt > 0.0 {
            settings.kd * (error - settings.last_error) / dt
        } else {
            0.0
        };
        
        // Combined PID output
        let output = p_term + i_term + d_term;
        
        // Limit rod movement speed
        let max_movement = settings.rod_speed * dt;
        output.clamp(-max_movement, max_movement)
    }
    
    /// Adjust automatic (AR/LAR) rod positions
    /// positive delta = withdraw rods (increase power)
    /// negative delta = insert rods (decrease power)
    fn adjust_automatic_rods(&self, delta: f64) {
        let mut rods = self.control_rods.lock().unwrap();
        for rod in rods.iter_mut() {
            if rod.rod_type == RodType::Automatic {
                // Withdraw to increase power, insert to decrease
                rod.position = (rod.position + delta).clamp(0.0, 1.0);
            }
        }
    }
    
    /// Initiate emergency SCRAM
    pub fn scram(&self) {
        // Physically insert all control rods
        let total_rod_worth: f64 = {
            let mut rods = self.control_rods.lock().unwrap();
            let mut worth = 0.0;
            for rod in rods.iter_mut() {
                rod.position = 0.0;
                worth += rod.worth;
            }
            worth
        };
        
        // Update state
        let mut state = self.state.lock().unwrap();
        if !state.scram_active {
            state.scram_active = true;
            state.scram_time = 0.0;
            state.alerts.push("SCRAM INITIATED!".to_string());
            
            // Calculate new reactivity using Fortran
            let new_reactivity = fortran_ffi::calc_total_reactivity(
                state.avg_fuel_temp,
                state.avg_graphite_temp,
                state.avg_coolant_void,
                state.xenon_135,
                total_rod_worth,
                state.smoothed_reactivity,
                state.dt,
                true,
            );
            
            state.smoothed_reactivity = new_reactivity;
            state.reactivity = new_reactivity;
            state.reactivity_dollars = new_reactivity / constants::BETA_EFF;
        }
    }
    
    /// Reset SCRAM
    pub fn reset_scram(&self) {
        let mut state = self.state.lock().unwrap();
        state.scram_active = false;
        state.scram_time = 0.0;
    }
    
    /// Move a control rod
    pub fn move_rod(&self, rod_id: usize, new_position: f64) {
        let mut rods = self.control_rods.lock().unwrap();
        if let Some(rod) = rods.get_mut(rod_id) {
            rod.position = new_position.clamp(0.0, 1.0);
        }
    }
    
    /// Move all rods of a specific type
    pub fn move_rod_group(&self, rod_type: RodType, new_position: f64) {
        let mut rods = self.control_rods.lock().unwrap();
        for rod in rods.iter_mut() {
            if rod.rod_type == rod_type {
                rod.position = new_position.clamp(0.0, 1.0);
            }
        }
    }
    
    /// Enable or disable automatic regulator (AR/LAR)
    pub fn set_auto_regulator_enabled(&self, enabled: bool) {
        let mut state = self.state.lock().unwrap();
        state.auto_regulator.enabled = enabled;
        
        // Reset PID state when toggling
        if enabled {
            state.auto_regulator.integral_error = 0.0;
            state.auto_regulator.last_error = 0.0;
        }
    }
    
    /// Set target power for automatic regulator
    pub fn set_target_power(&self, target_percent: f64) {
        let mut state = self.state.lock().unwrap();
        // Clamp target power to safe operating range (5% - 110%)
        state.auto_regulator.target_power = target_percent.clamp(5.0, 110.0);
        
        // Reset integral error when target changes to avoid overshoot
        state.auto_regulator.integral_error = 0.0;
    }
    
    /// Get automatic regulator settings
    pub fn get_auto_regulator(&self) -> AutoRegulatorSettings {
        self.state.lock().unwrap().auto_regulator.clone()
    }
    
    /// Get current state snapshot
    pub fn get_state(&self) -> ReactorState {
        self.state.lock().unwrap().clone()
    }
    
    /// Get control rod positions
    pub fn get_control_rods(&self) -> Vec<ControlRod> {
        self.control_rods.lock().unwrap().clone()
    }
    
    /// Get fuel channel data
    pub fn get_fuel_channels(&self) -> Vec<FuelChannel> {
        self.fuel_channels.lock().unwrap().clone()
    }
    
    /// Synchronize all fuel channel parameters from global state
    /// This ensures all 1661 channels have the same values (no diffusion coupling yet)
    /// 
    /// Currently synchronized parameters:
    /// - Thermal: fuel_temp, coolant_temp, graphite_temp, coolant_void
    /// - Neutronics: neutron_flux, power_density, local_power
    /// - Xenon/Iodine: iodine_135, xenon_135
    /// - Reactivity: local_reactivity
    /// 
    /// NOT synchronized (per-channel values preserved):
    /// - Position: id, grid_x, grid_y, x, y
    /// - Fuel state: burnup, enrichment
    /// - Control rod: has_control_rod, control_rod_id, local_rod_position
    /// - Neighbors: neighbors (for future diffusion)
    /// - Thermal-hydraulic: pressure, flow_rate, inlet_temp, outlet_temp (will vary per channel)
    pub fn synchronize_fuel_channels(&self) {
        let state = self.state.lock().unwrap();
        let mut channels = self.fuel_channels.lock().unwrap();
        
        // Calculate per-channel power (uniform distribution for now)
        let num_channels = channels.len() as f64;
        let power_per_channel = if num_channels > 0.0 {
            state.power_mw / num_channels
        } else {
            0.0
        };
        
        // Power density: power / channel volume
        // Channel active length ~7m, fuel rod diameter ~13.6mm
        // Approximate volume per channel: π * (0.68cm)² * 700cm ≈ 1017 cm³ = 1.017e-3 m³
        let channel_volume_m3 = 1.017e-3;
        let power_density = power_per_channel / channel_volume_m3;
        
        // Copy global state values to all channels
        for channel in channels.iter_mut() {
            // Thermal parameters (synchronized from global averages)
            channel.fuel_temp = state.avg_fuel_temp;
            channel.coolant_temp = state.avg_coolant_temp;
            channel.graphite_temp = state.avg_graphite_temp;
            channel.coolant_void = state.avg_coolant_void;
            
            // Neutronics (synchronized)
            channel.neutron_flux = state.neutron_population;
            channel.power_density = power_density;
            channel.local_power = power_per_channel;
            
            // Xenon/Iodine (synchronized from global)
            channel.iodine_135 = state.iodine_135;
            channel.xenon_135 = state.xenon_135;
            
            // Local reactivity (synchronized from global)
            channel.local_reactivity = state.reactivity;
            
            // Thermal-hydraulic: outlet temp based on power and flow
            // Q = m_dot * Cp * (T_out - T_in)
            // For water: Cp ≈ 4.5 kJ/(kg·K) at operating conditions
            // T_out = T_in + Q / (m_dot * Cp)
            if channel.flow_rate > 0.0 {
                let cp_water = 4.5e3; // J/(kg·K)
                let delta_t = (power_per_channel * 1e6) / (channel.flow_rate * cp_water);
                channel.outlet_temp = channel.inlet_temp + delta_t;
            }
            
            // Note: burnup, enrichment, control rod info, neighbors are NOT synchronized
            // They retain their per-channel values
        }
    }
    
    /// Get fuel channels with synchronized parameters
    /// This is the main method for getting channel data for visualization
    pub fn get_fuel_channels_synchronized(&self) -> Vec<FuelChannel> {
        // First synchronize, then return
        self.synchronize_fuel_channels();
        self.fuel_channels.lock().unwrap().clone()
    }
    
    /// Reset simulation to initial state (shutdown, cold, no xenon)
    pub fn reset(&self) {
        let mut state = self.state.lock().unwrap();
        *state = ReactorState::default();
        
        // Reset all control rods to fully inserted (shutdown)
        let mut rods = self.control_rods.lock().unwrap();
        for rod in rods.iter_mut() {
            rod.position = 0.0;  // All rods fully inserted for shutdown
        }
        
        // Reset fuel channels to cold shutdown state
        let mut channels = self.fuel_channels.lock().unwrap();
        for channel in channels.iter_mut() {
            // Thermal parameters (cold shutdown)
            channel.fuel_temp = channel_defaults::FUEL_TEMP_K;
            channel.coolant_temp = channel_defaults::COOLANT_TEMP_K;
            channel.graphite_temp = channel_defaults::GRAPHITE_TEMP_K;
            channel.coolant_void = channel_defaults::COOLANT_VOID_PERCENT;
            
            // Thermal-hydraulic parameters (reset to nominal cold values)
            channel.pressure = channel_defaults::PRESSURE_MPA;
            channel.flow_rate = channel_defaults::FLOW_RATE_KG_S;
            channel.inlet_temp = channel_defaults::INLET_TEMP_K;
            channel.outlet_temp = channel_defaults::OUTLET_TEMP_K;
            
            // Neutronics (shutdown)
            channel.neutron_flux = channel_defaults::NEUTRON_FLUX;
            channel.power_density = channel_defaults::POWER_DENSITY_MW_M3;
            channel.local_power = channel_defaults::LOCAL_POWER_MW;
            
            // Xenon/Iodine (fresh start)
            channel.iodine_135 = channel_defaults::IODINE_135;
            channel.xenon_135 = channel_defaults::XENON_135;
            
            // Fuel state - burnup resets to fresh fuel
            channel.burnup = channel_defaults::BURNUP_MWD_KGU;
            // enrichment stays at its value (could be different per channel)
            
            // Control rod position - if channel has a rod, it's inserted
            if channel.has_control_rod {
                channel.local_rod_position = 0.0;  // Fully inserted
            }
            
            // Local reactivity
            channel.local_reactivity = channel_defaults::LOCAL_REACTIVITY;
            
            // Note: neighbors vector is NOT reset - it's a structural property
        }
    }
}
