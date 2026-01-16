//! RBMK Reactor Simulation State
//!
//! This module contains the reactor state and simulation logic.
//! All physics calculations are delegated to Fortran via FFI.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::fortran_ffi;

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

/// State of a single fuel channel
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuelChannel {
    pub id: usize,
    pub x: f64,  // Position in core [cm]
    pub y: f64,
    pub fuel_temp: f64,      // [K]
    pub coolant_temp: f64,   // [K]
    pub coolant_void: f64,   // [%]
    pub neutron_flux: f64,   // Relative flux
    pub burnup: f64,         // [MWd/kgU]
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
        // Create equilibrium cosine flux distribution
        let axial_flux: Vec<f64> = (0..50)
            .map(|i| {
                let z = (i as f64 - 25.0) / 25.0; // -1 to 1
                (1.0 - z * z).max(0.0) // Parabolic approximation
            })
            .collect();
        
        Self {
            time: 0.0,
            dt: 0.1,
            power_mw: 3200.0,
            power_percent: 100.0,
            neutron_population: 1.0,
            precursors: constants::BETA_EFF / (constants::NEUTRON_LIFETIME * 0.0767), // Equilibrium
            k_eff: 1.0,
            reactivity: 0.0,
            reactivity_dollars: 0.0,
            period: f64::INFINITY,
            iodine_135: 1.0e15,  // Equilibrium value
            xenon_135: 3.0e15,   // Equilibrium value
            xenon_reactivity: -0.03,
            avg_fuel_temp: 900.0,      // Equilibrium at 100% power
            avg_coolant_temp: 550.0,   // Below saturation (558K) - no void at equilibrium
            avg_graphite_temp: 650.0,  // Equilibrium at 100% power
            avg_coolant_void: 0.0,
            scram_active: false,
            scram_time: 0.0,
            axial_flux,
            alerts: Vec::new(),
            explosion_occurred: false,
            explosion_time: 0.0,
            smoothed_reactivity: 0.0,
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
        
        // Initialize control rods with realistic startup positions
        for i in 0..constants::NUM_CONTROL_RODS {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (constants::NUM_CONTROL_RODS as f64);
            let radius = constants::CORE_RADIUS_CM * 0.7;
            
            let (rod_type, position) = if i < 24 {
                (RodType::Emergency, 1.0)   // AZ - fully extracted, ready for SCRAM
            } else if i < 48 {
                (RodType::Automatic, 0.25)  // AR/LAR - 25% extracted
            } else if i < 72 {
                (RodType::Shortened, 0.55)  // USP - 55% extracted
            } else {
                (RodType::Manual, 0.15)     // RR - 15% extracted (mostly inserted)
            };
            
            // Rod worth varies by type
            let worth = match rod_type {
                RodType::Emergency => 0.002,
                RodType::Automatic => 0.001,
                RodType::Shortened => 0.0008,
                RodType::Manual => 0.0006,
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
        
        // Initialize fuel channels (simplified grid)
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
                        id,
                        x,
                        y,
                        fuel_temp: 900.0,
                        coolant_temp: 550.0,
                        coolant_void: 0.0,
                        neutron_flux: 1.0,
                        burnup: 10.0,
                    });
                    id += 1;
                }
            }
        }
        
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
    
    /// Reset simulation to initial state
    pub fn reset(&self) {
        let mut state = self.state.lock().unwrap();
        *state = ReactorState::default();
        
        let mut rods = self.control_rods.lock().unwrap();
        for rod in rods.iter_mut() {
            rod.position = match rod.rod_type {
                RodType::Emergency => 1.0,
                RodType::Automatic => 0.25,
                RodType::Shortened => 0.55,
                RodType::Manual => 0.15,
            };
        }
    }
}
