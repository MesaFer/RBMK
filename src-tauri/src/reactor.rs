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
    
    // Steam explosion state - based on physics conditions
    // A steam explosion occurs when:
    // 1. Rapid vaporization of coolant (high void fraction + high temperature)
    // 2. Fuel temperature approaches melting point
    // 3. Pressure buildup from steam exceeds containment capacity
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
        
        // Initialize control rods with realistic startup positions:
        // AZ (Emergency): 100% extracted - ready to drop for safety
        // RR (Manual): 15% - main control rods for startup, mostly inserted
        // AR/LAR (Automatic): 25% - automatic regulation with headroom
        // USP (Shortened): 55% - axial flux shaping, partially inserted
        //
        // Rod distribution: 24 Emergency, 24 Automatic, 24 Shortened, 139 Manual
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
            
            // Rod worth varies by type - emergency rods have higher worth
            let worth = match rod_type {
                RodType::Emergency => 0.002,   // AZ rods: ~0.2% each, 24 rods = 4.8% total
                RodType::Automatic => 0.001,   // AR/LAR: ~0.1% each, 24 rods = 2.4% total
                RodType::Shortened => 0.0008,  // USP: ~0.08% each, 24 rods = 1.9% total
                RodType::Manual => 0.0006,     // RR: ~0.06% each, 139 rods = 8.3% total
            };
            // Total rod worth when all inserted: ~17.4%
            // This ensures deep subcriticality during SCRAM
            
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
                        fuel_temp: 900.0,      // Equilibrium at 100% power
                        coolant_temp: 550.0,   // Below saturation (558K)
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
    
    /// Perform one simulation step using improved numerical methods
    /// Uses 4th-order Runge-Kutta for point kinetics with strong negative feedback
    pub fn step(&self) {
        let mut state = self.state.lock().unwrap();
        let control_rods = self.control_rods.lock().unwrap();
        
        state.alerts.clear();
        let dt = state.dt;
        
        // Calculate total control rod worth (negative reactivity when inserted)
        let total_rod_worth: f64 = control_rods.iter()
            .map(|rod| {
                // Rod worth depends on position: 0 = fully inserted (max worth), 1 = withdrawn (no worth)
                let insertion = 1.0 - rod.position; // How much is inserted
                rod.worth * insertion
            })
            .sum();
        
        // Handle SCRAM timing (rods are physically moved in scram() function)
        // This just tracks the time since SCRAM for display purposes
        if state.scram_active {
            state.scram_time += dt;
        }
        
        // Note: scram_reactivity is no longer needed as a separate term
        // because the rods are physically inserted in the scram() function,
        // and their worth is already calculated in rod_reactivity below.
        // The old code added scram_reactivity on top of rod_reactivity,
        // which caused double-counting when rods were also moved via UI.
        
        // Calculate reactivity from various sources
        // At equilibrium with startup rod positions, total reactivity should be ~0
        
        // 1. Base excess reactivity (reactor is supercritical without rods)
        // Rod positions at startup:
        // - Emergency (24 rods): 100% extracted = 0% insertion → 0 worth
        // - Automatic (24 rods): 25% extracted = 75% insertion → 24 × 0.001 × 0.75 = 0.018
        // - Shortened (24 rods): 55% extracted = 45% insertion → 24 × 0.0008 × 0.45 = 0.00864
        // - Manual (139 rods): 15% extracted = 85% insertion → 139 × 0.0006 × 0.85 = 0.0709
        // Total rod worth at startup = 0.018 + 0.00864 + 0.0709 = 0.0975
        // So base reactivity should balance this for criticality
        let base_reactivity = 0.0975;
        
        // 2. Temperature feedback (Doppler effect - STRONG negative feedback)
        // This is the primary stabilizing mechanism
        // At reference temp (900K at 100% power), this is zero
        // IMPORTANT: Doppler feedback only provides NEGATIVE reactivity when temp > ref
        // When temp < ref, we limit the positive contribution to prevent
        // the reactor from stabilizing at low power instead of shutting down
        let ref_fuel_temp = 900.0;
        // Doppler coefficient: -2e-5 to -5e-5 per K is realistic for RBMK
        let alpha_fuel = -5.0e-5; // Fuel temperature coefficient [1/K]
        let fuel_temp_reactivity = if state.avg_fuel_temp > ref_fuel_temp {
            // Normal Doppler feedback - negative when hot
            alpha_fuel * (state.avg_fuel_temp - ref_fuel_temp)
        } else {
            // Limit positive feedback when cold - reactor should still shut down
            // Real reactors have other mechanisms that prevent restart at low temp
            (alpha_fuel * (state.avg_fuel_temp - ref_fuel_temp)).min(0.005) // Max +0.5% from cold fuel
        };
        
        // 3. Graphite temperature coefficient (POSITIVE in RBMK!)
        // Graphite acts as moderator - when it heats up, moderation improves slightly
        // This is a delayed positive feedback due to graphite's large thermal mass
        // Reference temperature at 100% power is 650K
        // When cold, graphite provides NEGATIVE reactivity (less moderation)
        let ref_graphite_temp = 650.0;
        // Positive coefficient: ~+1e-5 per K (smaller than fuel Doppler, but positive)
        let alpha_graphite = 1.0e-5; // Graphite temperature coefficient [1/K] - POSITIVE
        let graphite_temp_reactivity = alpha_graphite * (state.avg_graphite_temp - ref_graphite_temp);
        // Note: When graphite is cold (below ref), this gives NEGATIVE reactivity, which is correct
        
        // 4. Void coefficient (POSITIVE in RBMK - this is the dangerous part!)
        // At 0% void, this is zero
        // Real RBMK had void coefficient of about +4.5 β (very dangerous!)
        // This means 100% void would add about +4.5 * 0.0065 = +0.029 reactivity
        // We model this as: α_void ≈ +4.5β / 100% = +0.00029 per % void
        let alpha_void = 4.5 * constants::BETA_EFF / 100.0; // ~0.00029 per % void
        let void_reactivity = alpha_void * state.avg_coolant_void;
        
        // 5. Power coefficient - REMOVED
        // The power coefficient was incorrectly adding positive reactivity at low power,
        // which prevented the reactor from shutting down properly.
        // Temperature feedback (Doppler) already provides the necessary power-dependent feedback.
        let power_reactivity = 0.0;
        
        // 6. Xenon poisoning (negative)
        // Xe-135 has huge absorption cross-section, causes significant negative reactivity
        let xe_reactivity = -1.0e-18 * state.xenon_135; // Proportional to Xe concentration
        
        // 7. Control rod worth (negative when inserted)
        let rod_reactivity = -total_rod_worth;
        
        // Calculate target reactivity (before smoothing)
        // Note: At equilibrium (100% power, 900K fuel, 650K graphite, 0% void):
        // - base_reactivity = +0.0975
        // - fuel_temp_reactivity = 0 (at reference)
        // - graphite_temp_reactivity = 0 (at reference)
        // - void_reactivity = 0 (no void)
        // - power_reactivity = 0 (at 100%)
        // - xe_reactivity ≈ -0.003 (equilibrium Xe)
        // - rod_reactivity ≈ -0.0975 (balanced by rods at startup positions)
        // Total ≈ 0 (critical)
        //
        // During SCRAM: all rods are fully inserted (position = 0), so rod_reactivity
        // = -(24×0.002 + 24×0.001 + 24×0.0008 + 139×0.0006) = -0.175
        // This gives total reactivity of about -7.5% = -11.5$ (deeply subcritical)
        let target_reactivity = base_reactivity + fuel_temp_reactivity + graphite_temp_reactivity
                               + void_reactivity + power_reactivity + xe_reactivity
                               + rod_reactivity;
        
        // Apply exponential smoothing to reactivity changes for numerical stability
        // This simulates the physical reality that reactivity changes are not instantaneous
        // During SCRAM, use much faster response to reflect rapid rod insertion
        let reactivity_smoothing_tau = if state.scram_active { 0.05 } else { 0.3 }; // seconds
        let smoothing_alpha = (dt / reactivity_smoothing_tau).min(1.0);
        state.smoothed_reactivity += smoothing_alpha * (target_reactivity - state.smoothed_reactivity);
        
        // Clamp reactivity to physically reasonable bounds
        // Reactivity cannot exceed ~1$ (prompt critical) for any sustained period
        // and cannot go below about -10% (all rods in)
        state.smoothed_reactivity = state.smoothed_reactivity.clamp(-0.10, 0.02);
        
        // Use smoothed reactivity for display and calculations
        state.reactivity = state.smoothed_reactivity;
        state.reactivity_dollars = state.reactivity / constants::BETA_EFF;
        
        // k_eff calculation with protection against division issues
        if state.reactivity.abs() < 0.99 {
            state.k_eff = 1.0 / (1.0 - state.reactivity);
        } else {
            state.k_eff = if state.reactivity > 0.0 { 100.0 } else { 0.01 };
        }
        
        // Solve point kinetics equations using 4th-order Runge-Kutta method
        // dn/dt = (ρ - β) / Λ * n + λ * C
        // dC/dt = β / Λ * n - λ * C
        let lambda = 0.0767; // Decay constant for delayed neutrons [1/s]
        let rho = state.smoothed_reactivity;
        let beta = constants::BETA_EFF;
        let lifetime = constants::NEUTRON_LIFETIME;
        
        // For strongly negative reactivity (SCRAM), use smaller time steps for stability
        // The point kinetics equations become stiff when |rho| >> beta
        let effective_dt = if rho < -0.01 {
            // Use sub-stepping for numerical stability during SCRAM
            dt.min(0.01) // Max 10ms steps when deeply subcritical
        } else {
            dt
        };
        let num_substeps = (dt / effective_dt).ceil() as usize;
        let substep_dt = dt / (num_substeps as f64);
        
        // RK4 derivatives function with reactivity feedback
        let derivatives = |n: f64, c: f64, fuel_temp: f64, current_rho: f64| -> (f64, f64, f64) {
            // For deeply subcritical reactor, temperature feedback is minimal
            // because the reactor is shutting down regardless of temperature
            let temp_feedback = if current_rho < -0.01 {
                0.0 // Ignore temperature feedback during shutdown
            } else {
                let feedback = alpha_fuel * (fuel_temp - ref_fuel_temp);
                if fuel_temp < ref_fuel_temp {
                    feedback.min(0.005) // Limit positive feedback from cold fuel
                } else {
                    feedback
                }
            };
            let effective_rho = (current_rho + temp_feedback).clamp(-0.15, 0.02);
            
            // Point kinetics equations
            // dn/dt = (ρ - β) / Λ * n + λ * C
            // dC/dt = β / Λ * n - λ * C
            let dn_dt = ((effective_rho - beta) / lifetime) * n + lambda * c;
            let dc_dt = (beta / lifetime) * n - lambda * c;
            
            // Temperature changes with power - cooling when power drops
            let power_frac = n.clamp(0.0, 10.0);
            let target_temp = 400.0 + 500.0 * power_frac;
            let dtemp_dt = (target_temp - fuel_temp) / 2.0;
            
            (dn_dt, dc_dt, dtemp_dt)
        };
        
        // Initialize state for sub-stepping
        let mut n_current = state.neutron_population;
        let mut c_current = state.precursors;
        let mut t_current = state.avg_fuel_temp;
        
        // Run sub-steps for numerical stability
        for _ in 0..num_substeps {
            // RK4 stages with coupled temperature feedback
            let (k1_n, k1_c, k1_t) = derivatives(n_current, c_current, t_current, rho);
            let (k2_n, k2_c, k2_t) = derivatives(
                n_current + 0.5 * substep_dt * k1_n,
                c_current + 0.5 * substep_dt * k1_c,
                t_current + 0.5 * substep_dt * k1_t,
                rho
            );
            let (k3_n, k3_c, k3_t) = derivatives(
                n_current + 0.5 * substep_dt * k2_n,
                c_current + 0.5 * substep_dt * k2_c,
                t_current + 0.5 * substep_dt * k2_t,
                rho
            );
            let (k4_n, k4_c, k4_t) = derivatives(
                n_current + substep_dt * k3_n,
                c_current + substep_dt * k3_c,
                t_current + substep_dt * k3_t,
                rho
            );
            
            // RK4 update
            n_current = (n_current + (substep_dt / 6.0) * (k1_n + 2.0 * k2_n + 2.0 * k3_n + k4_n))
                .clamp(1e-10, 10.0);
            c_current = (c_current + (substep_dt / 6.0) * (k1_c + 2.0 * k2_c + 2.0 * k3_c + k4_c))
                .max(0.0);
            t_current = t_current + (substep_dt / 6.0) * (k1_t + 2.0 * k2_t + 2.0 * k3_t + k4_t);
        }
        
        let n_new = n_current;
        let c_new = c_current;
        let t_new = t_current;
        let n0 = state.neutron_population;
        
        // Calculate reactor period from the actual rate of change
        let dn_dt_actual = (n_new - n0) / dt;
        if n0 > 1e-10 && dn_dt_actual.abs() > 1e-10 {
            state.period = n0 / dn_dt_actual;
            // Clamp period to reasonable range for display
            if state.period.abs() > 1e6 {
                state.period = f64::INFINITY;
            }
        } else {
            state.period = f64::INFINITY;
        }
        
        state.neutron_population = n_new.max(0.0);
        state.precursors = c_new.max(0.0);
        
        // Calculate power (proportional to neutron population)
        // Power cannot be negative
        state.power_mw = (constants::NOMINAL_POWER_MW * state.neutron_population).max(0.0);
        state.power_percent = (state.power_mw / constants::NOMINAL_POWER_MW * 100.0).max(0.0);
        
        // Update temperatures based on power (simplified thermal model)
        // Use the RK4 calculated temperature for fuel
        state.avg_fuel_temp = t_new.clamp(300.0, 3000.0);
        
        // Coolant and graphite follow with their own time constants
        // Coolant responds relatively quickly (few seconds)
        // Graphite has LARGE thermal mass - responds very slowly (minutes)
        let coolant_time_constant = 3.0; // seconds - coolant responds quickly
        let graphite_time_constant = 60.0; // seconds - graphite is SLOW (large thermal mass)
        
        let power_fraction = (state.power_percent / 100.0).clamp(0.0, 10.0);
        let target_coolant_temp = 400.0 + 150.0 * power_fraction;
        let target_graphite_temp = 400.0 + 250.0 * power_fraction;
        
        // Coolant temperature update (fast)
        let coolant_alpha = (dt / coolant_time_constant).min(1.0);
        state.avg_coolant_temp += coolant_alpha * (target_coolant_temp - state.avg_coolant_temp);
        
        // Graphite temperature update (SLOW - this creates delayed positive feedback!)
        // This is a key RBMK characteristic - graphite heats up slowly after power increase
        // causing delayed positive reactivity insertion
        let graphite_alpha = (dt / graphite_time_constant).min(1.0);
        state.avg_graphite_temp += graphite_alpha * (target_graphite_temp - state.avg_graphite_temp);
        
        // Clamp temperatures
        state.avg_coolant_temp = state.avg_coolant_temp.clamp(300.0, 1000.0);
        state.avg_graphite_temp = state.avg_graphite_temp.clamp(300.0, 1500.0);
        
        // Update void fraction (simplified boiling model)
        // Void forms when coolant temperature exceeds saturation (558 K at 7 MPa)
        // Void formation is relatively fast once boiling starts
        let saturation_temp = 558.0;
        let void_time_constant = 2.0; // seconds - void forms/collapses quickly
        let void_alpha = (dt / void_time_constant).min(1.0);
        
        if state.avg_coolant_temp > saturation_temp {
            let excess_temp = state.avg_coolant_temp - saturation_temp;
            // More aggressive void formation - this is the positive feedback mechanism
            let target_void = (excess_temp * 2.0).min(80.0); // Max 80% void
            state.avg_coolant_void += void_alpha * (target_void - state.avg_coolant_void);
        } else {
            // Void collapses when below saturation
            state.avg_coolant_void *= 1.0 - void_alpha;
        }
        state.avg_coolant_void = state.avg_coolant_void.clamp(0.0, 80.0);
        
        // Update xenon dynamics (simplified)
        let avg_flux = state.neutron_population * 1e14;
        let gamma_i = 0.061;
        let gamma_xe = 0.003;
        let lambda_i = 2.87e-5;
        let lambda_xe = 2.09e-5;
        let sigma_xe = 2.65e-18;
        let sigma_f = 0.0025;
        
        let fission_rate = sigma_f * avg_flux;
        let di_dt = gamma_i * fission_rate - lambda_i * state.iodine_135;
        let dxe_dt = gamma_xe * fission_rate + lambda_i * state.iodine_135
                   - lambda_xe * state.xenon_135 - sigma_xe * avg_flux * state.xenon_135 * 1e-24;
        
        state.iodine_135 = (state.iodine_135 + di_dt * dt).clamp(0.0, 1e20);
        state.xenon_135 = (state.xenon_135 + dxe_dt * dt).clamp(0.0, 1e20);
        
        // Update axial flux distribution
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
        
        // ============================================================
        // STEAM EXPLOSION DETECTION - Based on physics, not hardcoded
        // ============================================================
        // A steam explosion in RBMK occurs when multiple physical conditions combine:
        //
        // Physics of steam explosion:
        // 1. Fuel-coolant interaction (FCI): When fuel temperature exceeds ~2800K (UO2 melting),
        //    molten fuel can contact water, causing rapid steam generation
        // 2. Rapid void formation: High void fraction (>70%) with high coolant temp indicates
        //    massive steam generation that can't be relieved
        // 3. Prompt supercritical excursion: Reactivity > 1$ causes exponential power rise
        //    faster than any control system can respond
        // 4. Pressure wave: The combination creates a pressure wave that ruptures fuel channels
        //
        // The Chernobyl explosion occurred when:
        // - Void coefficient added ~$3-4 of reactivity in ~1 second
        // - Power spiked to ~30,000 MW (10x nominal) in milliseconds
        // - Fuel fragmented and contacted water → steam explosion
        //
        // We detect explosion based on these physics conditions:
        // IMPORTANT: Explosion cannot occur if reactivity is strongly negative
        // (reactor is shutting down, not running away)
        if !state.explosion_occurred && state.reactivity_dollars > -5.0 {
            // Physical constants for explosion detection
            const FUEL_MELTING_POINT: f64 = 2800.0;  // K - UO2 melting temperature
            const CRITICAL_VOID_FRACTION: f64 = 75.0; // % - near-complete voiding
            const CRITICAL_COOLANT_TEMP: f64 = 700.0; // K - well above saturation, superheated
            const PROMPT_SUPERCRITICAL: f64 = 1.0;    // $ - prompt critical threshold
            const EXTREME_POWER_FACTOR: f64 = 3.0;    // Power > 300% nominal
            
            // Calculate explosion probability based on physics conditions
            // Each condition contributes to the likelihood of explosion
            let mut explosion_severity: f64 = 0.0;
            
            // Condition 1: Fuel approaching or exceeding melting point
            // This is the most critical condition - molten fuel + water = explosion
            if state.avg_fuel_temp > FUEL_MELTING_POINT {
                // Fuel is melting - explosion is imminent
                explosion_severity += 1.0;
                state.alerts.push("CRITICAL: Fuel melting - core damage!".to_string());
            } else if state.avg_fuel_temp > FUEL_MELTING_POINT * 0.9 {
                // Fuel approaching melting - severe damage likely
                explosion_severity += 0.5;
                state.alerts.push("CRITICAL: Fuel temperature approaching melting point!".to_string());
            }
            
            // Condition 2: Rapid steam generation (high void + high temp)
            // This creates the pressure wave for the explosion
            if state.avg_coolant_void > CRITICAL_VOID_FRACTION &&
               state.avg_coolant_temp > CRITICAL_COOLANT_TEMP {
                // Massive steam generation - pressure buildup
                let void_excess = (state.avg_coolant_void - CRITICAL_VOID_FRACTION) / 25.0;
                let temp_excess = (state.avg_coolant_temp - CRITICAL_COOLANT_TEMP) / 300.0;
                explosion_severity += void_excess.min(1.0) * temp_excess.min(1.0);
                state.alerts.push("CRITICAL: Massive steam generation - pressure buildup!".to_string());
            }
            
            // Condition 3: Prompt supercritical condition
            // Reactivity > 1$ means power rises on prompt neutron timescale (microseconds)
            // This ONLY applies when reactivity is POSITIVE - negative reactivity cannot cause explosion
            if state.reactivity_dollars > PROMPT_SUPERCRITICAL {
                let supercritical_excess = (state.reactivity_dollars - PROMPT_SUPERCRITICAL) / 2.0;
                explosion_severity += supercritical_excess.min(1.0);
                state.alerts.push("CRITICAL: Prompt supercritical - uncontrolled power excursion!".to_string());
            }
            
            // Condition 4: Extreme power excursion
            // Power > 300% indicates runaway reaction
            // This ONLY counts if reactivity is positive (power is actually increasing uncontrollably)
            // During SCRAM, power may briefly spike but will decrease due to negative reactivity
            if state.power_percent > EXTREME_POWER_FACTOR * 100.0 && state.reactivity_dollars > 0.0 {
                let power_excess = (state.power_percent - EXTREME_POWER_FACTOR * 100.0) / 200.0;
                explosion_severity += power_excess.min(1.0);
            }
            
            // Explosion occurs when combined severity exceeds threshold
            // This represents the physical reality that multiple conditions must combine
            // A single condition alone may not cause explosion, but combinations do
            //
            // Severity thresholds:
            // - 0.5: Severe damage, possible localized rupture
            // - 1.0: Steam explosion likely
            // - 1.5: Catastrophic steam explosion certain
            //
            // We trigger at 1.0 to represent the point where physics dictates explosion
            const EXPLOSION_THRESHOLD: f64 = 1.0;
            
            if explosion_severity >= EXPLOSION_THRESHOLD {
                state.explosion_occurred = true;
                state.explosion_time = state.time;
                state.alerts.push("*** STEAM EXPLOSION - CORE DESTRUCTION ***".to_string());
            }
        }
        
        // Update time
        state.time += dt;
    }
    
    /// Initiate emergency SCRAM
    /// This drops all control rods into the core for emergency shutdown
    pub fn scram(&self) {
        // Physically insert all control rods to position 0 (fully inserted)
        // This is what happens during a real SCRAM - all rods drop by gravity
        // We do this FIRST to calculate the new reactivity
        let total_rod_worth: f64 = {
            let mut rods = self.control_rods.lock().unwrap();
            let mut worth = 0.0;
            for rod in rods.iter_mut() {
                rod.position = 0.0;
                worth += rod.worth; // All rods fully inserted = full worth
            }
            worth
        };
        
        // Now update state with immediate reactivity change
        let mut state = self.state.lock().unwrap();
        if !state.scram_active {
            state.scram_active = true;
            state.scram_time = 0.0;
            state.alerts.push("SCRAM INITIATED!".to_string());
            
            // Immediately apply the negative reactivity from rod insertion
            // This prevents the delay that was causing power spikes
            // base_reactivity = 0.0975, with all rods in: rod_reactivity = -total_rod_worth
            let new_reactivity = 0.0975 - total_rod_worth;
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
            // Reset to realistic startup positions
            rod.position = match rod.rod_type {
                RodType::Emergency => 1.0,   // AZ - fully extracted, ready for SCRAM
                RodType::Automatic => 0.25,  // AR/LAR - 25% extracted
                RodType::Shortened => 0.55,  // USP - 55% extracted
                RodType::Manual => 0.15,     // RR - 15% extracted (mostly inserted)
            };
        }
    }
}
