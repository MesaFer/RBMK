//! FFI bindings to Fortran RBMK physics library
//! 
//! This module provides safe Rust wrappers around the Fortran physics calculations.
//! The Fortran code is compiled to a DLL and loaded dynamically at runtime.

use std::sync::OnceLock;
use libloading::{Library, Symbol};

/// Global library handle
static FORTRAN_LIB: OnceLock<Library> = OnceLock::new();

// ============================================================================
// Type definitions for Fortran function signatures
// ============================================================================

/// Main simulation step function
type SimulationStep = unsafe extern "C" fn(
    // Time step
    dt: f64,
    // Input state
    neutron_population: f64,
    precursors: f64,
    fuel_temp: f64,
    coolant_temp: f64,
    graphite_temp: f64,
    coolant_void: f64,
    iodine_135: f64,
    xenon_135: f64,
    total_rod_worth: f64,
    smoothed_reactivity: f64,
    scram_active: i32,
    // Output state
    neutron_population_new: *mut f64,
    precursors_new: *mut f64,
    fuel_temp_new: *mut f64,
    coolant_temp_new: *mut f64,
    graphite_temp_new: *mut f64,
    coolant_void_new: *mut f64,
    iodine_new: *mut f64,
    xenon_new: *mut f64,
    reactivity_new: *mut f64,
    k_eff_new: *mut f64,
    power_mw: *mut f64,
    power_percent: *mut f64,
    period: *mut f64,
    explosion_severity: *mut f64,
    alert_flags: *mut i32,
);

type CalculateNeutronFlux = unsafe extern "C" fn(
    n_points: i32,
    dz: f64,
    flux: *mut f64,
    k_eff: *mut f64,
);

type UpdateAxialFlux = unsafe extern "C" fn(
    n_points: i32,
    neutron_population: f64,
    axial_flux: *mut f64,
);

type CalculateReactivity = unsafe extern "C" fn(
    k_eff: f64,
    fuel_temp: f64,
    coolant_void: f64,
    xe_concentration: f64,
    graphite_temp: f64,
    reactivity: *mut f64,
);

type CalculateTotalReactivity = unsafe extern "C" fn(
    fuel_temp: f64,
    graphite_temp: f64,
    coolant_void: f64,
    xenon_135: f64,
    rod_worth: f64,
    smoothed_reactivity: f64,
    dt: f64,
    scram_active: i32,
    new_reactivity: *mut f64,
);

type SolvePointKinetics = unsafe extern "C" fn(
    n_neutrons: f64,
    precursors: f64,
    reactivity: f64,
    dt: f64,
    n_new: *mut f64,
    precursors_new: *mut f64,
);

type SolvePointKineticsRk4 = unsafe extern "C" fn(
    n_neutrons: f64,
    precursors: f64,
    fuel_temp: f64,
    reactivity: f64,
    dt: f64,
    n_new: *mut f64,
    precursors_new: *mut f64,
    fuel_temp_new: *mut f64,
);

type CalculateXenonDynamics = unsafe extern "C" fn(
    iodine: f64,
    xenon: f64,
    neutron_flux: f64,
    dt: f64,
    iodine_new: *mut f64,
    xenon_new: *mut f64,
);

type CalculateEquilibriumXenon = unsafe extern "C" fn(
    power_fraction: f64,
    eq_iodine: *mut f64,
    eq_xenon: *mut f64,
);

type CalculateThermalPower = unsafe extern "C" fn(
    n_neutrons: f64,
    n_nominal: f64,
    power_mw: *mut f64,
);

type UpdateTemperatures = unsafe extern "C" fn(
    power_percent: f64,
    fuel_temp: f64,
    coolant_temp: f64,
    graphite_temp: f64,
    coolant_void: f64,
    dt: f64,
    fuel_temp_new: *mut f64,
    coolant_temp_new: *mut f64,
    graphite_temp_new: *mut f64,
    coolant_void_new: *mut f64,
);

type CalculateRodWorth = unsafe extern "C" fn(
    rod_position: f64,
    max_worth: f64,
    worth: *mut f64,
);

type SimulateScram = unsafe extern "C" fn(
    time_since_scram: f64,
    total_rod_worth: f64,
    reactivity_inserted: *mut f64,
);

type DetectExplosion = unsafe extern "C" fn(
    fuel_temp: f64,
    coolant_temp: f64,
    coolant_void: f64,
    reactivity_dollars: f64,
    power_percent: f64,
    explosion_severity: *mut f64,
);

type CheckSafetyLimits = unsafe extern "C" fn(
    power_percent: f64,
    reactivity_dollars: f64,
    fuel_temp: f64,
    coolant_void: f64,
    period: f64,
    alert_flags: *mut i32,
);

type GetConstants = unsafe extern "C" fn(
    beta_eff: *mut f64,
    neutron_lifetime: *mut f64,
    nominal_power: *mut f64,
);

// ============================================================================
// Library initialization
// ============================================================================

/// Initialize the Fortran library
fn get_library() -> &'static Library {
    FORTRAN_LIB.get_or_init(|| {
        // Try multiple locations for the DLL
        let dll_paths = [
            // Build output directory (set by build.rs)
            std::env::var("RBMK_DLL_PATH").ok(),
            // Current executable directory
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.join("rbmk_physics.dll").to_string_lossy().into_owned())),
            // Current working directory
            Some("rbmk_physics.dll".to_string()),
            // src-tauri directory
            Some("src-tauri/rbmk_physics.dll".to_string()),
            // Target debug directory
            Some("target/debug/rbmk_physics.dll".to_string()),
        ];
        
        for path in dll_paths.iter().flatten() {
            if let Ok(lib) = unsafe { Library::new(path) } {
                println!("Loaded Fortran library from: {}", path);
                return lib;
            }
        }
        
        panic!("Failed to load rbmk_physics.dll! Make sure gfortran is installed and the DLL was built.");
    })
}

// ============================================================================
// Simulation step result structure
// ============================================================================

/// Result of a simulation step from Fortran
#[derive(Debug, Clone)]
pub struct SimulationStepResult {
    pub neutron_population: f64,
    pub precursors: f64,
    pub fuel_temp: f64,
    pub coolant_temp: f64,
    pub graphite_temp: f64,
    pub coolant_void: f64,
    pub iodine_135: f64,
    pub xenon_135: f64,
    pub reactivity: f64,
    pub k_eff: f64,
    pub power_mw: f64,
    pub power_percent: f64,
    pub period: f64,
    pub explosion_severity: f64,
    pub alert_flags: i32,
}

// ============================================================================
// Safe Rust wrappers for Fortran functions
// ============================================================================

/// Perform one complete simulation step using Fortran physics
/// 
/// This is the main entry point that calls all physics calculations in Fortran
pub fn simulation_step(
    dt: f64,
    neutron_population: f64,
    precursors: f64,
    fuel_temp: f64,
    coolant_temp: f64,
    graphite_temp: f64,
    coolant_void: f64,
    iodine_135: f64,
    xenon_135: f64,
    total_rod_worth: f64,
    smoothed_reactivity: f64,
    scram_active: bool,
) -> SimulationStepResult {
    let lib = get_library();
    
    let mut result = SimulationStepResult {
        neutron_population: 0.0,
        precursors: 0.0,
        fuel_temp: 0.0,
        coolant_temp: 0.0,
        graphite_temp: 0.0,
        coolant_void: 0.0,
        iodine_135: 0.0,
        xenon_135: 0.0,
        reactivity: 0.0,
        k_eff: 1.0,
        power_mw: 0.0,
        power_percent: 0.0,
        period: f64::INFINITY,
        explosion_severity: 0.0,
        alert_flags: 0,
    };
    
    unsafe {
        let func: Symbol<SimulationStep> = lib
            .get(b"simulation_step")
            .expect("Failed to load simulation_step");
        
        func(
            dt,
            neutron_population,
            precursors,
            fuel_temp,
            coolant_temp,
            graphite_temp,
            coolant_void,
            iodine_135,
            xenon_135,
            total_rod_worth,
            smoothed_reactivity,
            if scram_active { 1 } else { 0 },
            &mut result.neutron_population,
            &mut result.precursors,
            &mut result.fuel_temp,
            &mut result.coolant_temp,
            &mut result.graphite_temp,
            &mut result.coolant_void,
            &mut result.iodine_135,
            &mut result.xenon_135,
            &mut result.reactivity,
            &mut result.k_eff,
            &mut result.power_mw,
            &mut result.power_percent,
            &mut result.period,
            &mut result.explosion_severity,
            &mut result.alert_flags,
        );
    }
    
    result
}

/// Calculate neutron flux distribution using one-group diffusion equation
pub fn calc_neutron_flux(n_points: usize, dz: f64) -> (Vec<f64>, f64) {
    let lib = get_library();
    let mut flux = vec![0.0f64; n_points];
    let mut k_eff: f64 = 1.0;
    
    unsafe {
        let func: Symbol<CalculateNeutronFlux> = lib
            .get(b"calculate_neutron_flux")
            .expect("Failed to load calculate_neutron_flux");
        
        func(
            n_points as i32,
            dz,
            flux.as_mut_ptr(),
            &mut k_eff,
        );
    }
    
    (flux, k_eff)
}

/// Update axial flux distribution based on neutron population
pub fn update_axial_flux(n_points: usize, neutron_population: f64) -> Vec<f64> {
    let lib = get_library();
    let mut flux = vec![0.0f64; n_points];
    
    unsafe {
        let func: Symbol<UpdateAxialFlux> = lib
            .get(b"update_axial_flux")
            .expect("Failed to load update_axial_flux");
        
        func(
            n_points as i32,
            neutron_population,
            flux.as_mut_ptr(),
        );
    }
    
    flux
}

/// Calculate total reactivity with all feedback effects
pub fn calc_reactivity(
    k_eff: f64,
    fuel_temp: f64,
    coolant_void: f64,
    xe_concentration: f64,
    graphite_temp: f64,
) -> f64 {
    let lib = get_library();
    let mut reactivity: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateReactivity> = lib
            .get(b"calculate_reactivity")
            .expect("Failed to load calculate_reactivity");
        
        func(
            k_eff,
            fuel_temp,
            coolant_void,
            xe_concentration,
            graphite_temp,
            &mut reactivity,
        );
    }
    
    reactivity
}

/// Calculate total reactivity from all sources for simulation step
pub fn calc_total_reactivity(
    fuel_temp: f64,
    graphite_temp: f64,
    coolant_void: f64,
    xenon_135: f64,
    rod_worth: f64,
    smoothed_reactivity: f64,
    dt: f64,
    scram_active: bool,
) -> f64 {
    let lib = get_library();
    let mut new_reactivity: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateTotalReactivity> = lib
            .get(b"calculate_total_reactivity")
            .expect("Failed to load calculate_total_reactivity");
        
        func(
            fuel_temp,
            graphite_temp,
            coolant_void,
            xenon_135,
            rod_worth,
            smoothed_reactivity,
            dt,
            if scram_active { 1 } else { 0 },
            &mut new_reactivity,
        );
    }
    
    new_reactivity
}

/// Solve point kinetics equations for one time step (simple Euler)
pub fn solve_kinetics(
    n_neutrons: f64,
    precursors: f64,
    reactivity: f64,
    dt: f64,
) -> (f64, f64) {
    let lib = get_library();
    let mut n_new: f64 = 0.0;
    let mut c_new: f64 = 0.0;
    
    unsafe {
        let func: Symbol<SolvePointKinetics> = lib
            .get(b"solve_point_kinetics")
            .expect("Failed to load solve_point_kinetics");
        
        func(
            n_neutrons,
            precursors,
            reactivity,
            dt,
            &mut n_new,
            &mut c_new,
        );
    }
    
    (n_new, c_new)
}

/// Solve point kinetics equations with RK4 and temperature feedback
pub fn solve_kinetics_rk4(
    n_neutrons: f64,
    precursors: f64,
    fuel_temp: f64,
    reactivity: f64,
    dt: f64,
) -> (f64, f64, f64) {
    let lib = get_library();
    let mut n_new: f64 = 0.0;
    let mut c_new: f64 = 0.0;
    let mut t_new: f64 = 0.0;
    
    unsafe {
        let func: Symbol<SolvePointKineticsRk4> = lib
            .get(b"solve_point_kinetics_rk4")
            .expect("Failed to load solve_point_kinetics_rk4");
        
        func(
            n_neutrons,
            precursors,
            fuel_temp,
            reactivity,
            dt,
            &mut n_new,
            &mut c_new,
            &mut t_new,
        );
    }
    
    (n_new, c_new, t_new)
}

/// Calculate xenon and iodine dynamics
pub fn calc_xenon(
    iodine: f64,
    xenon: f64,
    neutron_flux: f64,
    dt: f64,
) -> (f64, f64) {
    let lib = get_library();
    let mut i_new: f64 = 0.0;
    let mut xe_new: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateXenonDynamics> = lib
            .get(b"calculate_xenon_dynamics")
            .expect("Failed to load calculate_xenon_dynamics");
        
        func(
            iodine,
            xenon,
            neutron_flux,
            dt,
            &mut i_new,
            &mut xe_new,
        );
    }
    
    (i_new, xe_new)
}

/// Calculate equilibrium xenon concentration for given power level
pub fn calc_equilibrium_xenon(power_fraction: f64) -> (f64, f64) {
    let lib = get_library();
    let mut eq_iodine: f64 = 0.0;
    let mut eq_xenon: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateEquilibriumXenon> = lib
            .get(b"calculate_equilibrium_xenon")
            .expect("Failed to load calculate_equilibrium_xenon");
        
        func(power_fraction, &mut eq_iodine, &mut eq_xenon);
    }
    
    (eq_iodine, eq_xenon)
}

/// Calculate thermal power from neutron population
pub fn calc_power(n_neutrons: f64, n_nominal: f64) -> f64 {
    let lib = get_library();
    let mut power: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateThermalPower> = lib
            .get(b"calculate_thermal_power")
            .expect("Failed to load calculate_thermal_power");
        
        func(n_neutrons, n_nominal, &mut power);
    }
    
    power
}

/// Update temperatures based on power
pub fn update_temperatures(
    power_percent: f64,
    fuel_temp: f64,
    coolant_temp: f64,
    graphite_temp: f64,
    coolant_void: f64,
    dt: f64,
) -> (f64, f64, f64, f64) {
    let lib = get_library();
    let mut fuel_temp_new: f64 = 0.0;
    let mut coolant_temp_new: f64 = 0.0;
    let mut graphite_temp_new: f64 = 0.0;
    let mut coolant_void_new: f64 = 0.0;
    
    unsafe {
        let func: Symbol<UpdateTemperatures> = lib
            .get(b"update_temperatures")
            .expect("Failed to load update_temperatures");
        
        func(
            power_percent,
            fuel_temp,
            coolant_temp,
            graphite_temp,
            coolant_void,
            dt,
            &mut fuel_temp_new,
            &mut coolant_temp_new,
            &mut graphite_temp_new,
            &mut coolant_void_new,
        );
    }
    
    (fuel_temp_new, coolant_temp_new, graphite_temp_new, coolant_void_new)
}

/// Calculate control rod worth based on position
pub fn calc_rod_worth(rod_position: f64, max_worth: f64) -> f64 {
    let lib = get_library();
    let mut worth: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateRodWorth> = lib
            .get(b"calculate_rod_worth")
            .expect("Failed to load calculate_rod_worth");
        
        func(rod_position, max_worth, &mut worth);
    }
    
    worth
}

/// Simulate emergency SCRAM reactivity insertion
pub fn sim_scram(time_since_scram: f64, total_rod_worth: f64) -> f64 {
    let lib = get_library();
    let mut reactivity: f64 = 0.0;
    
    unsafe {
        let func: Symbol<SimulateScram> = lib
            .get(b"simulate_scram")
            .expect("Failed to load simulate_scram");
        
        func(time_since_scram, total_rod_worth, &mut reactivity);
    }
    
    reactivity
}

/// Detect steam explosion based on physics conditions
pub fn detect_explosion(
    fuel_temp: f64,
    coolant_temp: f64,
    coolant_void: f64,
    reactivity_dollars: f64,
    power_percent: f64,
) -> f64 {
    let lib = get_library();
    let mut severity: f64 = 0.0;
    
    unsafe {
        let func: Symbol<DetectExplosion> = lib
            .get(b"detect_explosion")
            .expect("Failed to load detect_explosion");
        
        func(
            fuel_temp,
            coolant_temp,
            coolant_void,
            reactivity_dollars,
            power_percent,
            &mut severity,
        );
    }
    
    severity
}

/// Check safety limits and return alert flags
/// Returns bit flags: 1=power, 2=reactivity, 4=prompt_critical, 
///                    8=fuel_temp, 16=void, 32=period
pub fn check_safety_limits(
    power_percent: f64,
    reactivity_dollars: f64,
    fuel_temp: f64,
    coolant_void: f64,
    period: f64,
) -> i32 {
    let lib = get_library();
    let mut flags: i32 = 0;
    
    unsafe {
        let func: Symbol<CheckSafetyLimits> = lib
            .get(b"check_safety_limits")
            .expect("Failed to load check_safety_limits");
        
        func(
            power_percent,
            reactivity_dollars,
            fuel_temp,
            coolant_void,
            period,
            &mut flags,
        );
    }
    
    flags
}

/// Get physical constants from Fortran
pub fn get_constants() -> (f64, f64, f64) {
    let lib = get_library();
    let mut beta_eff: f64 = 0.0;
    let mut neutron_lifetime: f64 = 0.0;
    let mut nominal_power: f64 = 0.0;
    
    unsafe {
        let func: Symbol<GetConstants> = lib
            .get(b"get_constants")
            .expect("Failed to load get_constants");
        
        func(&mut beta_eff, &mut neutron_lifetime, &mut nominal_power);
    }
    
    (beta_eff, neutron_lifetime, nominal_power)
}

// ============================================================================
// Alert flag constants
// ============================================================================

pub const ALERT_POWER_HIGH: i32 = 1;
pub const ALERT_REACTIVITY_HIGH: i32 = 2;
pub const ALERT_PROMPT_CRITICAL: i32 = 4;
pub const ALERT_FUEL_TEMP_HIGH: i32 = 8;
pub const ALERT_VOID_HIGH: i32 = 16;
pub const ALERT_SHORT_PERIOD: i32 = 32;

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_neutron_flux() {
        let (flux, k_eff) = calc_neutron_flux(50, 14.0);
        assert_eq!(flux.len(), 50);
        assert!(k_eff > 0.0);
    }
    
    #[test]
    fn test_reactivity() {
        let rho = calc_reactivity(1.0, 800.0, 0.0, 1e15, 600.0);
        // At k_eff = 1.0, base reactivity should be 0
        assert!(rho.abs() < 0.1);
    }
    
    #[test]
    fn test_kinetics() {
        let (n, c) = solve_kinetics(1.0, 0.0065, 0.0, 0.1);
        // At zero reactivity, neutron population should be stable
        assert!((n - 1.0).abs() < 0.1);
    }
}
