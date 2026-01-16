//! RBMK Reactor Simulation State
//!
//! This module contains the reactor state and simulation logic

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Physical constants for RBMK-1000
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
            avg_fuel_temp: 800.0,
            avg_coolant_temp: 560.0,
            avg_graphite_temp: 600.0,
            avg_coolant_void: 0.0,
            scram_active: false,
            scram_time: 0.0,
            axial_flux,
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
    /// Base rod worth to maintain criticality at startup
    base_rod_worth: f64,
}

impl Default for ReactorSimulator {
    fn default() -> Self {
        Self::new()
    }
}

impl ReactorSimulator {
    pub fn new() -> Self {
        let mut control_rods = Vec::new();
        
        // Initialize control rods
        // Total rod worth when fully inserted should be ~10% (0.1 Δk/k)
        // With 211 rods, each rod worth = 0.1 / 211 ≈ 0.000474
        // At 80% withdrawn (20% inserted): 211 * 0.000474 * 0.2 = 0.02
        // This should balance base_reactivity of 0.02
        for i in 0..constants::NUM_CONTROL_RODS {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (constants::NUM_CONTROL_RODS as f64);
            let radius = constants::CORE_RADIUS_CM * 0.7;
            
            control_rods.push(ControlRod {
                id: i,
                x: radius * angle.cos(),
                y: radius * angle.sin(),
                position: 0.8, // Mostly withdrawn (80%)
                rod_type: if i < 24 { RodType::Emergency }
                         else if i < 48 { RodType::Automatic }
                         else if i < 72 { RodType::Shortened }
                         else { RodType::Manual },
                worth: 0.0005, // Individual rod worth ~0.05% each, total ~10.5%
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
        
        // Calculate base rod worth needed to maintain criticality
        // This compensates for the initial excess reactivity
        let base_rod_worth = 0.0; // Will be calibrated on first step
        
        Self {
            state: Mutex::new(ReactorState::default()),
            control_rods: Mutex::new(control_rods),
            fuel_channels: Mutex::new(fuel_channels),
            running: Mutex::new(false),
            base_rod_worth,
        }
    }
    
    /// Perform one simulation step
    pub fn step(&self) {
        let mut state = self.state.lock().unwrap();
        let control_rods = self.control_rods.lock().unwrap();
        
        state.alerts.clear();
        
        // Calculate total control rod worth (negative reactivity when inserted)
        let total_rod_worth: f64 = control_rods.iter()
            .map(|rod| {
                // Rod worth depends on position: 0 = fully inserted (max worth), 1 = withdrawn (no worth)
                let insertion = 1.0 - rod.position; // How much is inserted
                rod.worth * insertion
            })
            .sum();
        
        // Handle SCRAM - rods drop in
        let scram_reactivity = if state.scram_active {
            state.scram_time += state.dt;
            // SCRAM inserts negative reactivity as rods drop
            let scram_worth = 0.08; // Total SCRAM worth ~8% Δk/k
            let insertion_fraction = (1.0 - (-3.0 * state.scram_time / 2.5).exp()).min(1.0);
            -scram_worth * insertion_fraction
        } else {
            0.0
        };
        
        // Calculate reactivity from various sources
        // At equilibrium (80% withdrawn, 100% power, 800K fuel temp), total reactivity should be ~0
        
        // 1. Base excess reactivity (reactor is supercritical without rods)
        // Total rod worth at 80% withdrawn = 211 rods * 0.0005 * 0.2 = 0.0211
        // Plus small xenon contribution ~0.000001
        // So base reactivity = 0.0211 to balance exactly
        let base_reactivity = 0.0211;
        
        // 2. Temperature feedback (Doppler effect - negative)
        // At reference temp (800K), this is zero
        let ref_fuel_temp = 800.0;
        let alpha_fuel = -3.0e-5; // Fuel temperature coefficient [1/K]
        let temp_reactivity = alpha_fuel * (state.avg_fuel_temp - ref_fuel_temp);
        
        // 3. Void coefficient (POSITIVE in RBMK - this is the dangerous part!)
        // At 0% void, this is zero
        let alpha_void = 5.0e-4; // Void coefficient [1/%void] - strong positive effect
        let void_reactivity = alpha_void * state.avg_coolant_void;
        
        // 4. Xenon poisoning (negative) - very small at equilibrium
        let xe_reactivity = -1.0e-7 * (state.xenon_135 / 3.0e15); // Nearly zero at equilibrium
        
        // 5. Control rod worth (negative when inserted)
        // At 80% withdrawn (20% inserted): 211 * 0.0005 * 0.2 = 0.0211
        let rod_reactivity = -total_rod_worth;
        
        // Total reactivity
        state.reactivity = base_reactivity + temp_reactivity + void_reactivity + xe_reactivity + rod_reactivity + scram_reactivity;
        state.reactivity_dollars = state.reactivity / constants::BETA_EFF;
        state.k_eff = 1.0 / (1.0 - state.reactivity);
        
        // Solve point kinetics equations
        // dn/dt = (ρ - β) / Λ * n + λ * C
        // dC/dt = β / Λ * n - λ * C
        let lambda = 0.0767; // Decay constant for delayed neutrons [1/s]
        let rho = state.reactivity;
        let beta = constants::BETA_EFF;
        let lifetime = constants::NEUTRON_LIFETIME;
        
        let dn_dt = ((rho - beta) / lifetime) * state.neutron_population + lambda * state.precursors;
        let dc_dt = (beta / lifetime) * state.neutron_population - lambda * state.precursors;
        
        // Simple Euler integration
        let n_new = (state.neutron_population + dn_dt * state.dt).max(0.0);
        let c_new = (state.precursors + dc_dt * state.dt).max(0.0);
        
        // Calculate reactor period
        if state.neutron_population > 1e-10 && (n_new - state.neutron_population).abs() > 1e-15 {
            let dn_dt_actual = (n_new - state.neutron_population) / state.dt;
            if dn_dt_actual.abs() > 1e-15 {
                state.period = state.neutron_population / dn_dt_actual;
            } else {
                state.period = f64::INFINITY;
            }
        } else {
            state.period = f64::INFINITY;
        }
        
        state.neutron_population = n_new;
        state.precursors = c_new;
        
        // Calculate power (proportional to neutron population)
        state.power_mw = constants::NOMINAL_POWER_MW * state.neutron_population;
        state.power_percent = state.power_mw / constants::NOMINAL_POWER_MW * 100.0;
        
        // Update temperatures based on power (simplified thermal model)
        // Temperatures respond slowly to power changes
        let thermal_time_constant = 5.0; // seconds
        let target_fuel_temp = 500.0 + 400.0 * (state.power_percent / 100.0);
        let target_coolant_temp = 500.0 + 80.0 * (state.power_percent / 100.0);
        let target_graphite_temp = 500.0 + 150.0 * (state.power_percent / 100.0);
        
        let alpha = state.dt / thermal_time_constant;
        state.avg_fuel_temp += alpha * (target_fuel_temp - state.avg_fuel_temp);
        state.avg_coolant_temp += alpha * (target_coolant_temp - state.avg_coolant_temp);
        state.avg_graphite_temp += alpha * (target_graphite_temp - state.avg_graphite_temp);
        
        // Update void fraction (simplified boiling model)
        // Void forms when coolant temperature exceeds saturation (558 K at 7 MPa)
        let saturation_temp = 558.0;
        if state.avg_coolant_temp > saturation_temp {
            let excess_temp = state.avg_coolant_temp - saturation_temp;
            let target_void = (excess_temp * 1.5).min(80.0); // Max 80% void
            state.avg_coolant_void += alpha * (target_void - state.avg_coolant_void);
        } else {
            state.avg_coolant_void *= 1.0 - alpha; // Void collapses
        }
        state.avg_coolant_void = state.avg_coolant_void.max(0.0);
        
        // Update xenon dynamics (simplified)
        // Xenon builds up during operation and decays
        let avg_flux = state.neutron_population * 1e14; // Scale to realistic flux
        let gamma_i = 0.061; // Iodine yield
        let gamma_xe = 0.003; // Direct xenon yield
        let lambda_i = 2.87e-5; // Iodine decay constant
        let lambda_xe = 2.09e-5; // Xenon decay constant
        let sigma_xe = 2.65e-18; // Xenon absorption cross-section
        let sigma_f = 0.0025; // Fission cross-section
        
        let fission_rate = sigma_f * avg_flux;
        let di_dt = gamma_i * fission_rate - lambda_i * state.iodine_135;
        let dxe_dt = gamma_xe * fission_rate + lambda_i * state.iodine_135 
                   - lambda_xe * state.xenon_135 - sigma_xe * avg_flux * state.xenon_135 * 1e-24;
        
        state.iodine_135 = (state.iodine_135 + di_dt * state.dt).max(0.0);
        state.xenon_135 = (state.xenon_135 + dxe_dt * state.dt).max(0.0);
        
        // Update axial flux distribution (simplified - cosine shape)
        let n_pop = state.neutron_population;
        for (i, flux) in state.axial_flux.iter_mut().enumerate() {
            let z = (i as f64 - 25.0) / 25.0;
            *flux = n_pop * (1.0 - z * z).max(0.0);
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
        if state.period.is_finite() && state.period > 0.0 && state.period < 20.0 {
            let period = state.period;
            state.alerts.push(format!("WARNING: Short reactor period: {:.1}s", period));
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
    
    /// Reset simulation to initial state
    pub fn reset(&self) {
        let mut state = self.state.lock().unwrap();
        *state = ReactorState::default();
        
        let mut rods = self.control_rods.lock().unwrap();
        for rod in rods.iter_mut() {
            rod.position = 0.8; // Reset to 80% withdrawn
        }
    }
}
