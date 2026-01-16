//! RBMK Reactor Simulation State
//! 
//! This module contains the reactor state and simulation logic

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::fortran_ffi;

/// Physical constants for RBMK-1000
pub mod constants {
    pub const NOMINAL_POWER_MW: f64 = 3200.0;
    pub const NUM_FUEL_CHANNELS: usize = 1661;
    pub const CORE_HEIGHT_CM: f64 = 700.0;
    pub const CORE_RADIUS_CM: f64 = 593.0;
    pub const NUM_CONTROL_RODS: usize = 211;
    pub const BETA_EFF: f64 = 0.0065;
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
}

impl Default for ReactorState {
    fn default() -> Self {
        Self {
            time: 0.0,
            dt: 0.1,
            power_mw: 3200.0,
            power_percent: 100.0,
            neutron_population: 1.0,
            precursors: 0.0065, // Equilibrium value
            k_eff: 1.0,
            reactivity: 0.0,
            reactivity_dollars: 0.0,
            period: f64::INFINITY,
            iodine_135: 1.0e15,  // Equilibrium value
            xenon_135: 3.0e15,   // Equilibrium value
            xenon_reactivity: -0.03,
            avg_fuel_temp: 800.0,
            avg_coolant_temp: 560.0,
            avg_graphite_temp: 600.0,
            avg_coolant_void: 0.0,
            scram_active: false,
            scram_time: 0.0,
            axial_flux: vec![0.0; 50],
            alerts: Vec::new(),
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
        
        // Initialize control rods (simplified - just a few representative rods)
        for i in 0..constants::NUM_CONTROL_RODS {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (constants::NUM_CONTROL_RODS as f64);
            let radius = constants::CORE_RADIUS_CM * 0.7;
            
            control_rods.push(ControlRod {
                id: i,
                x: radius * angle.cos(),
                y: radius * angle.sin(),
                position: 0.8, // Mostly withdrawn
                rod_type: if i < 24 { RodType::Emergency } 
                         else if i < 48 { RodType::Automatic }
                         else if i < 72 { RodType::Shortened }
                         else { RodType::Manual },
                worth: 0.001, // Individual rod worth
            });
        }
        
        // Initialize fuel channels (simplified grid)
        let mut fuel_channels = Vec::new();
        let grid_size = 41; // Approximate square root of 1661
        let spacing = 2.0 * constants::CORE_RADIUS_CM / (grid_size as f64);
        
        let mut id = 0;
        for i in 0..grid_size {
            for j in 0..grid_size {
                let x = -constants::CORE_RADIUS_CM + spacing * (i as f64 + 0.5);
                let y = -constants::CORE_RADIUS_CM + spacing * (j as f64 + 0.5);
                
                // Only include channels within the circular core
                if x*x + y*y <= constants::CORE_RADIUS_CM * constants::CORE_RADIUS_CM {
                    fuel_channels.push(FuelChannel {
                        id,
                        x,
                        y,
                        fuel_temp: 800.0,
                        coolant_temp: 560.0,
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
    
    /// Perform one simulation step
    pub fn step(&self) {
        let mut state = self.state.lock().unwrap();
        let control_rods = self.control_rods.lock().unwrap();
        
        state.alerts.clear();
        
        // Calculate total control rod worth
        let total_rod_worth: f64 = control_rods.iter()
            .map(|rod| fortran_ffi::calc_rod_worth(rod.position, rod.worth))
            .sum();
        
        // Handle SCRAM
        let scram_reactivity = if state.scram_active {
            state.scram_time += state.dt;
            fortran_ffi::sim_scram(state.scram_time, 0.08) // Total SCRAM worth ~8%
        } else {
            0.0
        };
        
        // Calculate neutron flux distribution (using Fortran)
        let (flux, k_eff) = fortran_ffi::calc_neutron_flux(50, constants::CORE_HEIGHT_CM / 50.0);
        state.axial_flux = flux;
        state.k_eff = k_eff;
        
        // Calculate reactivity (using Fortran)
        let base_reactivity = fortran_ffi::calc_reactivity(
            k_eff,
            state.avg_fuel_temp,
            state.avg_coolant_void,
            state.xenon_135,
            state.avg_graphite_temp,
        );
        
        state.reactivity = base_reactivity - total_rod_worth + scram_reactivity;
        state.reactivity_dollars = state.reactivity / constants::BETA_EFF;
        
        // Solve point kinetics (using Fortran)
        let (n_new, c_new) = fortran_ffi::solve_kinetics(
            state.neutron_population,
            state.precursors,
            state.reactivity,
            state.dt,
        );
        
        // Calculate reactor period
        if state.neutron_population > 0.0 && n_new != state.neutron_population {
            let dn_dt = (n_new - state.neutron_population) / state.dt;
            if dn_dt.abs() > 1e-10 {
                state.period = state.neutron_population / dn_dt;
            } else {
                state.period = f64::INFINITY;
            }
        }
        
        state.neutron_population = n_new;
        state.precursors = c_new;
        
        // Calculate power
        state.power_mw = fortran_ffi::calc_power(state.neutron_population, 1.0);
        state.power_percent = state.power_mw / constants::NOMINAL_POWER_MW * 100.0;
        
        // Calculate xenon dynamics (using Fortran)
        let avg_flux = state.axial_flux.iter().sum::<f64>() / state.axial_flux.len() as f64;
        let (i_new, xe_new) = fortran_ffi::calc_xenon(
            state.iodine_135,
            state.xenon_135,
            avg_flux * 1e14, // Scale to realistic flux
            state.dt,
        );
        
        state.iodine_135 = i_new;
        state.xenon_135 = xe_new;
        
        // Update temperatures (simplified model)
        let power_factor = state.power_percent / 100.0;
        state.avg_fuel_temp = 500.0 + 500.0 * power_factor;
        state.avg_coolant_temp = 500.0 + 80.0 * power_factor;
        state.avg_graphite_temp = 500.0 + 200.0 * power_factor;
        
        // Update void fraction (simplified)
        if state.avg_coolant_temp > 558.0 { // Saturation temperature at 7 MPa
            state.avg_coolant_void = (state.avg_coolant_temp - 558.0) * 2.0;
            state.avg_coolant_void = state.avg_coolant_void.min(80.0);
        } else {
            state.avg_coolant_void = 0.0;
        }
        
        // Safety checks and alerts
        if state.power_percent > 110.0 {
            state.alerts.push("WARNING: Power exceeds 110% nominal!".to_string());
        }
        if state.reactivity_dollars > 0.5 {
            state.alerts.push("WARNING: Reactivity exceeds 0.5$!".to_string());
        }
        if state.reactivity_dollars > 1.0 {
            state.alerts.push("CRITICAL: Prompt critical condition!".to_string());
        }
        if state.avg_fuel_temp > 1200.0 {
            state.alerts.push("WARNING: Fuel temperature exceeds limit!".to_string());
        }
        if state.avg_coolant_void > 50.0 {
            state.alerts.push("WARNING: High void fraction - positive reactivity feedback!".to_string());
        }
        if state.period > 0.0 && state.period < 20.0 {
            state.alerts.push(format!("WARNING: Short reactor period: {:.1}s", state.period));
        }
        
        // Update time
        state.time += state.dt;
    }
    
    /// Initiate emergency SCRAM
    pub fn scram(&self) {
        let mut state = self.state.lock().unwrap();
        if !state.scram_active {
            state.scram_active = true;
            state.scram_time = 0.0;
            state.alerts.push("SCRAM INITIATED!".to_string());
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
}
