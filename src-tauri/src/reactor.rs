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
                let mut channels = create_channels_from_config(&config);
                // Build neighbor connectivity map for 2D diffusion
                build_neighbor_map(&mut channels);
                return channels;
            }
        }
    }
    
    // Fallback: generate default circular grid if config not found
    eprintln!("[reactor] Warning: Could not load layout config, using fallback circular grid");
    let mut channels = create_fallback_channels();
    build_neighbor_map(&mut channels);
    channels
}

/// Link control rods to fuel channels based on grid position
///
/// In RBMK, control rods are in SEPARATE channels from fuel channels.
/// They don't share the same grid position. Control rods affect the
/// GLOBAL reactivity through total_rod_worth.
///
/// For LOCAL effects (hot spots), we don't link rods to channels directly.
/// Instead, the local_rod_worth is calculated dynamically in step_spatial()
/// based on distance to nearby rods.
fn link_control_rods_to_channels(channels: &mut Vec<FuelChannel>, _rods: &[ControlRod]) {
    // In RBMK, control rods and fuel channels are in different grid positions
    // We don't link them directly - local effects are calculated dynamically
    // based on distance to nearby rods in step_spatial()
    
    // All channels start without a linked control rod
    for channel in channels.iter_mut() {
        channel.has_control_rod = false;
        channel.control_rod_id = None;
        channel.local_rod_position = 1.0;  // No rod = effectively withdrawn
    }
    
    println!("[reactor] Control rods not linked to fuel channels (separate grid positions)");
    println!("[reactor] Local rod effects will be calculated dynamically based on distance");
}

/// Build neighbor connectivity map for 2D diffusion coupling
/// 
/// For each fuel channel, finds neighboring channels based on grid position.
/// Uses 4-connectivity (von Neumann neighborhood): up, down, left, right.
/// Neighbors are channels that are exactly 1 grid cell apart.
/// 
/// This connectivity is essential for:
/// - 2D neutron diffusion (flux exchange between neighbors)
/// - Thermal conduction through graphite
/// - Local xenon redistribution effects
fn build_neighbor_map(channels: &mut Vec<FuelChannel>) {
    // Build a lookup map: (grid_x, grid_y) -> channel index
    let mut grid_to_index: HashMap<(i32, i32), usize> = HashMap::new();
    for (idx, channel) in channels.iter().enumerate() {
        grid_to_index.insert((channel.grid_x, channel.grid_y), idx);
    }
    
    // For each channel, find its neighbors
    // Using 4-connectivity (von Neumann neighborhood)
    let neighbor_offsets: [(i32, i32); 4] = [
        (0, -1),  // Up
        (0, 1),   // Down
        (-1, 0),  // Left
        (1, 0),   // Right
    ];
    
    // We need to collect neighbor info first, then apply it
    // (to avoid borrowing issues)
    let neighbor_lists: Vec<Vec<usize>> = channels.iter().map(|channel| {
        let mut neighbors = Vec::new();
        for (dx, dy) in &neighbor_offsets {
            let neighbor_pos = (channel.grid_x + dx, channel.grid_y + dy);
            if let Some(&neighbor_idx) = grid_to_index.get(&neighbor_pos) {
                neighbors.push(neighbor_idx);
            }
        }
        neighbors
    }).collect();
    
    // Apply neighbor lists to channels
    for (channel, neighbors) in channels.iter_mut().zip(neighbor_lists.into_iter()) {
        channel.neighbors = neighbors;
    }
    
    // Statistics
    let total_neighbors: usize = channels.iter().map(|c| c.neighbors.len()).sum();
    let avg_neighbors = total_neighbors as f64 / channels.len() as f64;
    let edge_channels = channels.iter().filter(|c| c.neighbors.len() < 4).count();
    
    println!("[reactor] Built neighbor map: {} channels, {:.2} avg neighbors, {} edge channels",
             channels.len(), avg_neighbors, edge_channels);
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
    pub const NEUTRON_FLUX: f64 = 1e-6;         // Very low neutron source (subcritical)
    pub const PRECURSORS: f64 = 0.0;            // No precursors - fresh start
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
                precursors: channel_defaults::PRECURSORS,
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

/// Load control rod positions from the OPB-82 layout config
/// Control rod types: RR (manual), AR (automatic), LAR (local automatic), USP (shortened), AZ (emergency)
fn load_control_rods_from_config() -> Vec<ControlRod> {
    // Try to load from config file
    let config_paths = [
        "config/opb82_layout.json",
        "../config/opb82_layout.json",
        "ui/public/config/opb82_layout.json",
    ];
    
    for path in &config_paths {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(config) = serde_json::from_str::<LayoutConfig>(&content) {
                let rods = create_control_rods_from_config(&config);
                return rods;
            }
        }
    }
    
    // Fallback: generate default circular arrangement if config not found
    eprintln!("[reactor] Warning: Could not load control rod config, using fallback circular arrangement");
    create_fallback_control_rods()
}

/// Create control rods from loaded config
fn create_control_rods_from_config(config: &LayoutConfig) -> Vec<ControlRod> {
    let mut control_rods = Vec::new();
    let mut id = 0;
    
    // Rod types to load from config: RR, AR, LAR, USP, AZ
    let rod_types = [
        ("RR", RodType::Manual, 0.0008),      // Manual control rods
        ("AR", RodType::Automatic, 0.0015),   // Automatic rods
        ("LAR", RodType::Automatic, 0.0015),  // Local automatic (same type as AR)
        ("USP", RodType::Shortened, 0.001),   // Shortened absorbers
        ("AZ", RodType::Emergency, 0.003),    // Emergency protection
    ];
    
    for (type_name, rod_type, worth) in &rod_types {
        if let Some(cells) = config.cells.get(*type_name) {
            for cell in cells {
                // Convert grid position to cm from center
                let x = (cell.grid_x as f64 - GRID_CENTER + 0.5) * GRID_SPACING_CM;
                let y = (cell.grid_y as f64 - GRID_CENTER + 0.5) * GRID_SPACING_CM;
                
                control_rods.push(ControlRod {
                    id,
                    grid_x: cell.grid_x,
                    grid_y: cell.grid_y,
                    x,
                    y,
                    position: 0.0,  // All rods fully inserted (shutdown)
                    rod_type: rod_type.clone(),
                    worth: *worth,
                    channel_type: type_name.to_string(),  // Store original channel type
                });
                id += 1;
            }
        }
    }
    
    println!("[reactor] Loaded {} control rods from config", control_rods.len());
    control_rods
}

/// Fallback: create simplified circular arrangement if config not found
fn create_fallback_control_rods() -> Vec<ControlRod> {
    let mut control_rods = Vec::new();
    
    // RBMK-1000 has 211 control rods total:
    // - 24 AZ (emergency) rods
    // - 24 AR/LAR (automatic regulator) rods
    // - 24 USP (shortened absorber) rods
    // - 139 RR (manual) rods
    for i in 0..constants::NUM_CONTROL_RODS {
        let angle = 2.0 * std::f64::consts::PI * (i as f64) / (constants::NUM_CONTROL_RODS as f64);
        let radius = constants::CORE_RADIUS_CM * 0.7;
        
        let x = radius * angle.cos();
        let y = radius * angle.sin();
        
        // Convert to grid coordinates
        let grid_x = ((x / GRID_SPACING_CM) + GRID_CENTER).round() as i32;
        let grid_y = ((y / GRID_SPACING_CM) + GRID_CENTER).round() as i32;
        
        let (rod_type, position) = if i < 24 {
            (RodType::Emergency, 0.0)   // AZ - fully inserted (shutdown)
        } else if i < 48 {
            (RodType::Automatic, 0.0)   // AR/LAR - fully inserted (shutdown)
        } else if i < 72 {
            (RodType::Shortened, 0.0)   // USP - fully inserted (shutdown)
        } else {
            (RodType::Manual, 0.0)      // RR - fully inserted (shutdown)
        };
        
        let worth = match rod_type {
            RodType::Emergency => 0.003,
            RodType::Automatic => 0.0015,
            RodType::Shortened => 0.001,
            RodType::Manual => 0.0008,
        };
        
        let channel_type = if i < 24 {
            "AZ".to_string()
        } else if i < 48 {
            "AR".to_string()
        } else if i < 72 {
            "USP".to_string()
        } else {
            "RR".to_string()
        };
        
        control_rods.push(ControlRod {
            id: i,
            grid_x,
            grid_y,
            x,
            y,
            position,
            rod_type,
            worth,
            channel_type,
        });
    }
    
    control_rods
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
                    precursors: channel_defaults::PRECURSORS,
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
    /// Prompt neutron lifetime for RBMK (graphite-moderated)
    /// RBMK has longer lifetime (~1ms) compared to LWR (~0.1ms)
    pub const NEUTRON_LIFETIME: f64 = 1.0e-3; // seconds
    
    /// Number of delayed neutron groups
    pub const NUM_DELAYED_GROUPS: usize = 6;
    
    /// 6-group delayed neutron fractions (βᵢ) for U-235
    pub const BETA_I: [f64; NUM_DELAYED_GROUPS] = [
        0.000215,  // Group 1
        0.001424,  // Group 2
        0.001274,  // Group 3
        0.002568,  // Group 4
        0.000748,  // Group 5
        0.000273,  // Group 6
    ];
    
    /// 6-group decay constants (λᵢ) in s⁻¹ for U-235
    pub const LAMBDA_I: [f64; NUM_DELAYED_GROUPS] = [
        0.0124,    // Group 1, T₁/₂ = 55.9s
        0.0305,    // Group 2, T₁/₂ = 22.7s
        0.111,     // Group 3, T₁/₂ = 6.24s
        0.301,     // Group 4, T₁/₂ = 2.30s
        1.14,      // Group 5, T₁/₂ = 0.61s
        3.01,      // Group 6, T₁/₂ = 0.23s
    ];
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
    pub precursors: f64,     // Delayed neutron precursors [atoms/cm³]
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
    pub grid_x: i32,         // Grid position (0-47)
    pub grid_y: i32,         // Grid position (0-47)
    pub x: f64,              // Position in core [cm] from center
    pub y: f64,              // Position in core [cm] from center
    pub position: f64,       // 0.0 = fully inserted, 1.0 = fully withdrawn
    pub rod_type: RodType,
    pub worth: f64,          // [Δk/k]
    pub channel_type: String, // Original channel type from config (RR, AR, LAR, USP, AZ)
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
            kp: 0.01,             // Proportional gain - more aggressive for realistic control
            ki: 0.001,            // Integral gain - faster correction
            kd: 0.005,            // Derivative gain (damping)
            integral_error: 0.0,
            last_error: 0.0,
            rod_speed: 0.02,      // 2% per second max speed (realistic for RBMK)
            deadband: 0.2,        // ±0.2% deadband (tighter control)
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
    pub precursors: f64,     // Total delayed neutron precursors (sum of 6 groups)
    
    /// 6-group delayed neutron precursor concentrations
    /// Each group has different decay constant and fraction:
    /// - Group 1: β₁=0.000215, λ₁=0.0124 s⁻¹, T₁/₂=55.9s (longest-lived)
    /// - Group 2: β₂=0.001424, λ₂=0.0305 s⁻¹, T₁/₂=22.7s
    /// - Group 3: β₃=0.001274, λ₃=0.111 s⁻¹, T₁/₂=6.24s
    /// - Group 4: β₄=0.002568, λ₄=0.301 s⁻¹, T₁/₂=2.30s (largest fraction)
    /// - Group 5: β₅=0.000748, λ₅=1.14 s⁻¹, T₁/₂=0.61s
    /// - Group 6: β₆=0.000273, λ₆=3.01 s⁻¹, T₁/₂=0.23s (shortest-lived)
    pub precursors_6: [f64; constants::NUM_DELAYED_GROUPS],
    
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
            precursors_6: [0.0; constants::NUM_DELAYED_GROUPS], // All 6 groups at zero
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
        // Load control rods from OPB-82 layout config
        let control_rods = load_control_rods_from_config();
        
        // Load fuel channels from OPB-82 layout config (1661 TK cells)
        let mut fuel_channels = load_fuel_channels_from_config();
        
        // Link control rods to fuel channels for local reactivity effects
        link_control_rods_to_channels(&mut fuel_channels, &control_rods);
        
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
            
            // Always accumulate integral for better tracking
            // Anti-windup: limit integral accumulation and decay when near target
            let max_integral = 100.0; // Limit integral term
            
            if error.abs() > state.auto_regulator.deadband {
                // Accumulate integral error
                state.auto_regulator.integral_error =
                    (state.auto_regulator.integral_error + error * dt).clamp(-max_integral, max_integral);
            } else {
                // Slowly decay integral when within deadband to prevent windup
                state.auto_regulator.integral_error *= 0.99;
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
    ///
    /// The AR system works by adjusting rod positions to control reactivity:
    /// - If power < target: withdraw rods (add positive reactivity) to increase power
    /// - If power > target: insert rods (add negative reactivity) to decrease power
    fn calculate_ar_adjustment(&self, settings: &AutoRegulatorSettings, current_power: f64, dt: f64) -> f64 {
        let error = settings.target_power - current_power;
        
        // If within deadband AND power is stable (small derivative), no adjustment needed
        // But if error is large, always adjust regardless of deadband
        let large_error_threshold = 2.0; // 2% is considered a large error
        if error.abs() <= settings.deadband && error.abs() < large_error_threshold {
            return 0.0;
        }
        
        // PID control calculation
        // P: Proportional to current error - this is the main driver
        // Larger error = larger rod movement
        let p_term = settings.kp * error;
        
        // I: Integral of error over time (already accumulated in settings)
        // This helps eliminate steady-state error
        let i_term = settings.ki * settings.integral_error;
        
        // D: Rate of change of error - provides damping
        // Prevents overshoot by slowing down when approaching target
        let d_term = if dt > 0.0 {
            settings.kd * (error - settings.last_error) / dt
        } else {
            0.0
        };
        
        // Combined PID output
        let mut output = p_term + i_term + d_term;
        
        // For large errors, use more aggressive control
        // This ensures the AR system actively drives the reactor to target power
        if error.abs() > large_error_threshold {
            // Boost proportional response for large errors
            let boost_factor = 1.0 + (error.abs() - large_error_threshold) / 10.0;
            output *= boost_factor.min(3.0); // Cap boost at 3x
        }
        
        // Limit rod movement speed (realistic RBMK rod drive speed)
        // RBMK rod drive: ~0.4 m/min = 0.67 cm/s
        // For 7m (700cm) travel: full extraction takes ~17 minutes
        // rod_speed is fraction per second, so 0.02 = 2%/s = full travel in 50s (accelerated for simulation)
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
        let clamped_position = new_position.clamp(0.0, 1.0);
        
        // Collect rod IDs being moved
        let moved_rod_ids: Vec<usize> = {
            let mut rods = self.control_rods.lock().unwrap();
            let mut ids = Vec::new();
            for rod in rods.iter_mut() {
                if rod.rod_type == rod_type {
                    rod.position = clamped_position;
                    ids.push(rod.id);
                }
            }
            ids
        };
        
        // Update fuel channels that are linked to these control rods
        if !moved_rod_ids.is_empty() {
            let mut channels = self.fuel_channels.lock().unwrap();
            for channel in channels.iter_mut() {
                if channel.has_control_rod {
                    // Check if this channel is linked to one of the moved rods
                    if let Some(rod_id) = channel.control_rod_id {
                        if moved_rod_ids.contains(&rod_id) {
                            channel.local_rod_position = clamped_position;
                        }
                    }
                }
            }
        }
    }
    
    /// Move all rods of a specific channel type (RR, AR, LAR, USP, AZ)
    /// This allows separate control of AR and LAR rods which both have RodType::Automatic
    pub fn move_rod_group_by_channel_type(&self, channel_type: &str, new_position: f64) {
        let clamped_position = new_position.clamp(0.0, 1.0);
        
        // Collect rod IDs being moved
        let moved_rod_ids: Vec<usize> = {
            let mut rods = self.control_rods.lock().unwrap();
            let mut ids = Vec::new();
            for rod in rods.iter_mut() {
                if rod.channel_type == channel_type {
                    rod.position = clamped_position;
                    ids.push(rod.id);
                }
            }
            ids
        };
        
        // Update fuel channels that are linked to these control rods
        let mut updated_channels = 0;
        if !moved_rod_ids.is_empty() {
            let mut channels = self.fuel_channels.lock().unwrap();
            for channel in channels.iter_mut() {
                if channel.has_control_rod {
                    // Check if this channel is linked to one of the moved rods
                    if let Some(rod_id) = channel.control_rod_id {
                        if moved_rod_ids.contains(&rod_id) {
                            channel.local_rod_position = clamped_position;
                            updated_channels += 1;
                        }
                    }
                }
            }
        }
        
        println!("[reactor] Moved {} rods of type {} to position {:.1}%, updated {} channels",
                 moved_rod_ids.len(), channel_type, clamped_position * 100.0, updated_channels);
    }
    
    /// Move a control rod by grid position
    /// This allows individual rod control from the CYS panel
    /// Returns true if a rod was found and moved, false otherwise
    pub fn move_rod_by_grid_position(&self, grid_x: i32, grid_y: i32, new_position: f64) -> bool {
        let clamped_position = new_position.clamp(0.0, 1.0);
        
        // First, find and update the control rod, get its ID
        let rod_id: Option<usize> = {
            let mut rods = self.control_rods.lock().unwrap();
            let mut found_id = None;
            for rod in rods.iter_mut() {
                if rod.grid_x == grid_x && rod.grid_y == grid_y {
                    rod.position = clamped_position;
                    found_id = Some(rod.id);
                    break;
                }
            }
            found_id
        };
        
        if let Some(moved_rod_id) = rod_id {
            // Update all fuel channels that are linked to this rod
            let mut updated_channels = 0;
            {
                let mut channels = self.fuel_channels.lock().unwrap();
                for channel in channels.iter_mut() {
                    if channel.has_control_rod {
                        if let Some(channel_rod_id) = channel.control_rod_id {
                            if channel_rod_id == moved_rod_id {
                                channel.local_rod_position = clamped_position;
                                updated_channels += 1;
                            }
                        }
                    }
                }
            }
            println!("[reactor] Moved rod {} at ({}, {}) to position {:.1}%, updated {} channels",
                     moved_rod_id, grid_x, grid_y, clamped_position * 100.0, updated_channels);
            return true;
        }
        
        println!("[reactor] No rod found at grid position ({}, {})", grid_x, grid_y);
        false
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
        let old_target = state.auto_regulator.target_power;
        
        // Clamp target power to safe operating range (5% - 110%)
        let new_target = target_percent.clamp(5.0, 110.0);
        state.auto_regulator.target_power = new_target;
        
        // When target changes significantly, pre-seed the integral error
        // This helps the AR system respond faster to large target changes
        let target_change = new_target - old_target;
        if target_change.abs() > 1.0 {
            // Pre-seed integral to help drive the system toward new target
            // This gives the AR system a "head start" in the right direction
            state.auto_regulator.integral_error = target_change * 5.0;
            state.auto_regulator.last_error = target_change;
        } else {
            // Small change - just reset integral to avoid overshoot
            state.auto_regulator.integral_error = 0.0;
        }
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
    
    /// Perform one spatial simulation step using 2D diffusion physics
    ///
    /// This method uses the Fortran spatial physics module to calculate:
    /// - 2D neutron diffusion with neighbor coupling
    /// - Per-channel thermal-hydraulics
    /// - Per-channel xenon dynamics
    /// - Local reactivity feedback
    ///
    /// Each of the 1661 fuel channels is calculated independently with
    /// coupling to its neighbors through the diffusion equation.
    pub fn step_spatial(&self) {
        // First, run automatic regulator if enabled (before physics step)
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
        
        // Calculate total control rod worth
        let total_rod_worth = self.calculate_total_rod_worth();
        
        // Build rod position lookup for distance-based calculations
        // EXCLUDE AZ (emergency) rods from local power calculations
        // AZ rods are normally fully withdrawn and only used for SCRAM
        // They should not create hot spots in normal operation
        let rod_positions: Vec<(i32, i32, f64, f64)> = {
            let rods = self.control_rods.lock().unwrap();
            rods.iter()
                .filter(|r| r.rod_type != RodType::Emergency)  // Exclude AZ rods
                .map(|r| (r.grid_x, r.grid_y, r.position, r.worth))
                .collect()
        };
        
        // Prepare spatial input data from fuel channels
        let spatial_inputs: Vec<fortran_ffi::SpatialChannelInput> = {
            let channels = self.fuel_channels.lock().unwrap();
            
            channels.iter().map(|ch| {
                // Convert neighbor indices to i32, padding with -1
                let mut neighbors = vec![-1i32; fortran_ffi::MAX_NEIGHBORS];
                for (i, &n) in ch.neighbors.iter().take(fortran_ffi::MAX_NEIGHBORS).enumerate() {
                    neighbors[i] = n as i32;
                }
                
                // Calculate local rod worth based on distance to nearby rods
                // This creates local hot spots when a rod is withdrawn
                //
                // NEW APPROACH: Calculate the AVERAGE rod position in the neighborhood
                // This normalizes for edge effects where there are fewer rods nearby
                //
                // For each nearby rod, calculate its contribution based on:
                // 1. Distance (closer = stronger effect)
                // 2. Rod position (withdrawn = 1.0, inserted = 0.0)
                //
                // The effect uses Gaussian decay with distance for smoother gradients
                let mut weighted_position_sum = 0.0;  // Sum of (position * weight)
                let mut total_weight = 0.0;           // Sum of weights
                const MAX_ROD_DISTANCE: i32 = 6;      // Radius for rod influence
                const SIGMA: f64 = 2.5;               // Gaussian decay parameter
                
                for &(rod_x, rod_y, rod_position, _rod_worth) in &rod_positions {
                    let dx = (ch.grid_x - rod_x).abs();
                    let dy = (ch.grid_y - rod_y).abs();
                    let distance = dx + dy;  // Manhattan distance
                    
                    if distance <= MAX_ROD_DISTANCE {
                        // Gaussian decay for smoother effect
                        let distance_sq = (dx * dx + dy * dy) as f64;
                        let weight = (-distance_sq / (2.0 * SIGMA * SIGMA)).exp();
                        
                        // Accumulate weighted position
                        // rod_position: 0.0 = inserted, 1.0 = withdrawn
                        weighted_position_sum += rod_position * weight;
                        total_weight += weight;
                    }
                }
                
                // Calculate average rod position in neighborhood (normalized)
                // avg_position: 0.0 = all rods inserted, 1.0 = all rods withdrawn
                let avg_rod_position = if total_weight > 0.0 {
                    weighted_position_sum / total_weight
                } else {
                    0.5  // Default to middle if no rods nearby
                };
                
                // Convert to local_rod_worth for Fortran
                // local_rod_worth = 0.03 when all rods inserted (avg_position = 0)
                // local_rod_worth = 0.0 when all rods withdrawn (avg_position = 1)
                //
                // This creates HOT SPOTS where rods are withdrawn:
                // - Withdrawn rods (position=1): local_rod_worth = 0 -> high power
                // - Inserted rods (position=0): local_rod_worth = 0.03 -> normal power
                let local_rod_worth = 0.03 * (1.0 - avg_rod_position);
                
                fortran_ffi::SpatialChannelInput {
                    neutron_flux: ch.neutron_flux,
                    precursors: ch.precursors,
                    fuel_temp: ch.fuel_temp,
                    coolant_temp: ch.coolant_temp,
                    graphite_temp: ch.graphite_temp,
                    coolant_void: ch.coolant_void,
                    iodine: ch.iodine_135,
                    xenon: ch.xenon_135,
                    local_rod_worth,
                    x: ch.x,
                    y: ch.y,
                    neighbors,
                }
            }).collect()
        };
        
        // Get current state parameters
        let (dt, scram_active) = {
            let state = self.state.lock().unwrap();
            (state.dt, state.scram_active)
        };
        
        // Call Fortran spatial simulation
        let spatial_outputs = fortran_ffi::spatial_simulation_step(
            dt,
            total_rod_worth,
            scram_active,
            &spatial_inputs,
        );
        
        // Update fuel channels from spatial outputs
        {
            let mut channels = self.fuel_channels.lock().unwrap();
            for (ch, output) in channels.iter_mut().zip(spatial_outputs.iter()) {
                ch.neutron_flux = output.neutron_flux;
                ch.precursors = output.precursors;
                ch.fuel_temp = output.fuel_temp;
                ch.coolant_temp = output.coolant_temp;
                ch.graphite_temp = output.graphite_temp;
                ch.coolant_void = output.coolant_void;
                ch.iodine_135 = output.iodine;
                ch.xenon_135 = output.xenon;
                ch.local_power = output.local_power;
                ch.local_reactivity = output.local_reactivity;
                
                // Calculate power density from local power
                // Channel volume: π * (0.68cm)² * 700cm ≈ 1017 cm³ = 1.017e-3 m³
                let channel_volume_m3 = 1.017e-3;
                ch.power_density = output.local_power / channel_volume_m3;
                
                // Update outlet temperature based on power and flow
                if ch.flow_rate > 0.0 {
                    let cp_water = 4.5e3; // J/(kg·K)
                    let delta_t = (output.local_power * 1e6) / (ch.flow_rate * cp_water);
                    ch.outlet_temp = ch.inlet_temp + delta_t;
                }
            }
        }
        
        // Calculate global averages from per-channel data
        let (fuel_temps, coolant_temps, graphite_temps, voids, powers, xenons, iodines):
            (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) = {
            let channels = self.fuel_channels.lock().unwrap();
            let fuel_temps: Vec<f64> = channels.iter().map(|c| c.fuel_temp).collect();
            let coolant_temps: Vec<f64> = channels.iter().map(|c| c.coolant_temp).collect();
            let graphite_temps: Vec<f64> = channels.iter().map(|c| c.graphite_temp).collect();
            let voids: Vec<f64> = channels.iter().map(|c| c.coolant_void).collect();
            let powers: Vec<f64> = channels.iter().map(|c| c.local_power).collect();
            let xenons: Vec<f64> = channels.iter().map(|c| c.xenon_135).collect();
            let iodines: Vec<f64> = channels.iter().map(|c| c.iodine_135).collect();
            (fuel_temps, coolant_temps, graphite_temps, voids, powers, xenons, iodines)
        };
        
        let averages = fortran_ffi::calculate_global_averages(
            &fuel_temps,
            &coolant_temps,
            &graphite_temps,
            &voids,
            &powers,
            &xenons,
        );
        
        // Calculate average iodine (not in Fortran function, do it here)
        let avg_iodine = if !iodines.is_empty() {
            iodines.iter().sum::<f64>() / iodines.len() as f64
        } else {
            0.0
        };
        
        // Update global state from averages
        {
            let mut state = self.state.lock().unwrap();
            
            state.avg_fuel_temp = averages.avg_fuel_temp;
            state.avg_coolant_temp = averages.avg_coolant_temp;
            state.avg_graphite_temp = averages.avg_graphite_temp;
            state.avg_coolant_void = averages.avg_void;
            state.power_mw = averages.total_power;
            state.power_percent = averages.total_power / constants::NOMINAL_POWER_MW * 100.0;
            state.xenon_135 = averages.avg_xenon;
            state.iodine_135 = avg_iodine;
            
            // Calculate total neutron population and precursors from channels
            let channels = self.fuel_channels.lock().unwrap();
            let total_flux: f64 = channels.iter().map(|c| c.neutron_flux).sum();
            let total_precursors: f64 = channels.iter().map(|c| c.precursors).sum();
            let avg_reactivity: f64 = channels.iter().map(|c| c.local_reactivity).sum::<f64>()
                / channels.len() as f64;
            
            state.neutron_population = total_flux / channels.len() as f64;
            state.precursors = total_precursors / channels.len() as f64;
            state.reactivity = avg_reactivity;
            state.smoothed_reactivity = avg_reactivity;
            state.k_eff = 1.0 + avg_reactivity;
            state.reactivity_dollars = avg_reactivity / constants::BETA_EFF;
            
            // Calculate reactor period
            if avg_reactivity.abs() > 1e-10 {
                state.period = constants::NEUTRON_LIFETIME / avg_reactivity;
            } else {
                state.period = f64::INFINITY;
            }
            
            // Handle SCRAM timing
            if state.scram_active {
                state.scram_time += dt;
            }
            
            // Update automatic regulator state (PID integral/derivative terms)
            if state.auto_regulator.enabled && !state.scram_active {
                let error = state.auto_regulator.target_power - state.power_percent;
                let max_integral = 100.0;
                
                if error.abs() > state.auto_regulator.deadband {
                    state.auto_regulator.integral_error =
                        (state.auto_regulator.integral_error + error * dt).clamp(-max_integral, max_integral);
                } else {
                    state.auto_regulator.integral_error *= 0.99;
                }
                
                state.auto_regulator.last_error = error;
            }
            
            // Update axial flux distribution
            state.axial_flux = fortran_ffi::update_axial_flux(50, state.neutron_population);
            
            // Generate alerts
            state.alerts.clear();
            if state.power_percent > 110.0 {
                state.alerts.push("WARNING: Power exceeds 110% nominal!".to_string());
            }
            if state.reactivity_dollars > 0.5 {
                state.alerts.push("WARNING: Reactivity exceeds 0.5$!".to_string());
            }
            if state.reactivity_dollars >= 1.0 {
                state.alerts.push("CRITICAL: Prompt critical condition!".to_string());
            }
            if state.avg_fuel_temp > 2800.0 {
                state.alerts.push("WARNING: Fuel temperature exceeds limit!".to_string());
            }
            if state.avg_coolant_void > 50.0 {
                state.alerts.push("WARNING: High void fraction - positive reactivity feedback!".to_string());
            }
            if state.period.is_finite() && state.period > 0.0 && state.period < 30.0 {
                let period = state.period;
                state.alerts.push(format!("WARNING: Short reactor period: {:.1}s", period));
            }
            
            // Check for explosion using Fortran physics-based detection
            // This properly tracks peak power, cumulative energy, and fuel damage
            if !state.explosion_occurred {
                let explosion_severity = fortran_ffi::detect_explosion(
                    state.avg_fuel_temp,
                    state.avg_coolant_temp,
                    state.avg_coolant_void,
                    state.reactivity_dollars,
                    state.power_percent,
                );
                
                if explosion_severity >= 1.0 {
                    state.explosion_occurred = true;
                    state.explosion_time = state.time;
                    state.alerts.push("*** STEAM EXPLOSION - CORE DESTRUCTION ***".to_string());
                }
            }
            
            // Update time
            state.time += dt;
        }
    }
    
    /// Get fuel channels with their independent parameters
    /// Each channel has its own physics state from 2D spatial simulation
    /// This is the main method for getting channel data for visualization
    pub fn get_fuel_channels_synchronized(&self) -> Vec<FuelChannel> {
        // No synchronization - channels have independent values from spatial physics
        self.fuel_channels.lock().unwrap().clone()
    }
    
    /// Reset simulation to initial state (shutdown, cold, no xenon)
    pub fn reset(&self) {
        // Reset Fortran explosion tracking state
        fortran_ffi::reset_explosion_state();
        
        // Reset Fortran 6-group precursor state
        fortran_ffi::reset_precursors_6group_state();
        
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
            channel.precursors = channel_defaults::PRECURSORS;
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
