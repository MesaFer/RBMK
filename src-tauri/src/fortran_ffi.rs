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

/// Number of delayed neutron groups
pub const NUM_DELAYED_GROUPS: usize = 6;

/// 6-group point kinetics solver type
type SolvePointKinetics6Group = unsafe extern "C" fn(
    n_neutrons: f64,
    precursors_6: *const f64,  // Array of 6 precursor concentrations
    fuel_temp: f64,
    reactivity: f64,
    source_term: f64,
    dt: f64,
    n_new: *mut f64,
    precursors_6_new: *mut f64,  // Array of 6 new precursor concentrations
    fuel_temp_new: *mut f64,
);

/// Initialize 6-group precursors for steady state
type InitPrecursors6Group = unsafe extern "C" fn(
    n_neutrons: f64,
    precursors_6: *mut f64,  // Output array of 6 precursor concentrations
);

/// Sum 6-group precursors to get total
type SumPrecursors6Group = unsafe extern "C" fn(
    precursors_6: *const f64,
    total: *mut f64,
);

/// Calculate reactor period
type CalculateReactorPeriod = unsafe extern "C" fn(
    reactivity: f64,
    period: *mut f64,
);

/// Convert reactivity to dollars
type ReactivityToDollars = unsafe extern "C" fn(
    reactivity: f64,
    dollars: *mut f64,
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

type ResetExplosionState = unsafe extern "C" fn();

/// Reset 6-group precursor state in simulation module
type ResetPrecursors6GroupState = unsafe extern "C" fn();

/// Get current 6-group precursor concentrations
type GetPrecursors6Group = unsafe extern "C" fn(
    precursors_out: *mut f64,
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

/// Solve 6-group point kinetics equations with RK4 and temperature feedback
///
/// This is the physically accurate solver using 6 delayed neutron groups:
/// - Group 1: β₁=0.000215, λ₁=0.0124 s⁻¹, T₁/₂=55.9s
/// - Group 2: β₂=0.001424, λ₂=0.0305 s⁻¹, T₁/₂=22.7s
/// - Group 3: β₃=0.001274, λ₃=0.111 s⁻¹, T₁/₂=6.24s
/// - Group 4: β₄=0.002568, λ₄=0.301 s⁻¹, T₁/₂=2.30s
/// - Group 5: β₅=0.000748, λ₅=1.14 s⁻¹, T₁/₂=0.61s
/// - Group 6: β₆=0.000273, λ₆=3.01 s⁻¹, T₁/₂=0.23s
///
/// Total β ≈ 0.0065 (defines 1 dollar of reactivity)
pub fn solve_kinetics_6group(
    n_neutrons: f64,
    precursors_6: &[f64; NUM_DELAYED_GROUPS],
    fuel_temp: f64,
    reactivity: f64,
    source_term: f64,
    dt: f64,
) -> (f64, [f64; NUM_DELAYED_GROUPS], f64) {
    let lib = get_library();
    let mut n_new: f64 = 0.0;
    let mut c_new: [f64; NUM_DELAYED_GROUPS] = [0.0; NUM_DELAYED_GROUPS];
    let mut t_new: f64 = 0.0;
    
    unsafe {
        let func: Symbol<SolvePointKinetics6Group> = lib
            .get(b"solve_point_kinetics_6group")
            .expect("Failed to load solve_point_kinetics_6group");
        
        func(
            n_neutrons,
            precursors_6.as_ptr(),
            fuel_temp,
            reactivity,
            source_term,
            dt,
            &mut n_new,
            c_new.as_mut_ptr(),
            &mut t_new,
        );
    }
    
    (n_new, c_new, t_new)
}

/// Initialize 6-group precursor concentrations for steady state
///
/// At steady state: dCᵢ/dt = 0 => Cᵢ = βᵢ·n / (λᵢ·Λ)
pub fn init_precursors_6group(n_neutrons: f64) -> [f64; NUM_DELAYED_GROUPS] {
    let lib = get_library();
    let mut precursors: [f64; NUM_DELAYED_GROUPS] = [0.0; NUM_DELAYED_GROUPS];
    
    unsafe {
        let func: Symbol<InitPrecursors6Group> = lib
            .get(b"init_precursors_6group")
            .expect("Failed to load init_precursors_6group");
        
        func(n_neutrons, precursors.as_mut_ptr());
    }
    
    precursors
}

/// Sum 6-group precursor concentrations to get total
pub fn sum_precursors_6group(precursors_6: &[f64; NUM_DELAYED_GROUPS]) -> f64 {
    let lib = get_library();
    let mut total: f64 = 0.0;
    
    unsafe {
        let func: Symbol<SumPrecursors6Group> = lib
            .get(b"sum_precursors_6group")
            .expect("Failed to load sum_precursors_6group");
        
        func(precursors_6.as_ptr(), &mut total);
    }
    
    total
}

/// Calculate reactor period from reactivity
///
/// For delayed supercritical: T ≈ (β - ρ) / (λ_eff · ρ)
/// For prompt supercritical: T ≈ Λ / (ρ - β)
pub fn calculate_reactor_period(reactivity: f64) -> f64 {
    let lib = get_library();
    let mut period: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateReactorPeriod> = lib
            .get(b"calculate_reactor_period")
            .expect("Failed to load calculate_reactor_period");
        
        func(reactivity, &mut period);
    }
    
    period
}

/// Convert reactivity to dollars (1$ = β_eff ≈ 0.0065)
pub fn reactivity_to_dollars(reactivity: f64) -> f64 {
    let lib = get_library();
    let mut dollars: f64 = 0.0;
    
    unsafe {
        let func: Symbol<ReactivityToDollars> = lib
            .get(b"reactivity_to_dollars")
            .expect("Failed to load reactivity_to_dollars");
        
        func(reactivity, &mut dollars);
    }
    
    dollars
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

/// Reset explosion tracking state in Fortran module
/// This should be called when resetting the simulation
pub fn reset_explosion_state() {
    let lib = get_library();
    
    unsafe {
        let func: Symbol<ResetExplosionState> = lib
            .get(b"reset_explosion_state")
            .expect("Failed to load reset_explosion_state");
        
        func();
    }
}

/// Reset 6-group precursor state in Fortran simulation module
/// This should be called when resetting the simulation to clear internal state
pub fn reset_precursors_6group_state() {
    let lib = get_library();
    
    unsafe {
        let func: Symbol<ResetPrecursors6GroupState> = lib
            .get(b"reset_precursors_6group_state")
            .expect("Failed to load reset_precursors_6group_state");
        
        func();
    }
}

/// Get current 6-group precursor concentrations from Fortran simulation module
/// Useful for diagnostics and UI display
pub fn get_precursors_6group() -> [f64; NUM_DELAYED_GROUPS] {
    let lib = get_library();
    let mut precursors: [f64; NUM_DELAYED_GROUPS] = [0.0; NUM_DELAYED_GROUPS];
    
    unsafe {
        let func: Symbol<GetPrecursors6Group> = lib
            .get(b"get_precursors_6group")
            .expect("Failed to load get_precursors_6group");
        
        func(precursors.as_mut_ptr());
    }
    
    precursors
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

// ============================================================================
// Spatial physics types and functions (2D diffusion)
// ============================================================================

/// Maximum neighbors per channel (4-connectivity)
pub const MAX_NEIGHBORS: usize = 4;

/// Type for spatial simulation step function
type SpatialSimulationStep = unsafe extern "C" fn(
    // Number of channels
    num_channels: i32,
    // Time step
    dt: f64,
    // Global parameters
    total_rod_worth: f64,
    scram_active: i32,
    // Per-channel input arrays
    neutron_flux_in: *const f64,
    precursors_in: *const f64,
    fuel_temp_in: *const f64,
    coolant_temp_in: *const f64,
    graphite_temp_in: *const f64,
    coolant_void_in: *const f64,
    iodine_in: *const f64,
    xenon_in: *const f64,
    local_rod_worth_in: *const f64,
    // Neighbor connectivity
    neighbor_indices: *const i32,
    num_neighbors: *const i32,
    // Channel positions
    channel_x: *const f64,
    channel_y: *const f64,
    // Per-channel output arrays
    neutron_flux_out: *mut f64,
    precursors_out: *mut f64,
    fuel_temp_out: *mut f64,
    coolant_temp_out: *mut f64,
    graphite_temp_out: *mut f64,
    coolant_void_out: *mut f64,
    iodine_out: *mut f64,
    xenon_out: *mut f64,
    local_power_out: *mut f64,
    local_reactivity_out: *mut f64,
);

/// Type for flux initialization function
type InitializeFluxDistribution = unsafe extern "C" fn(
    num_channels: i32,
    channel_x: *const f64,
    channel_y: *const f64,
    initial_power: f64,
    neutron_flux_out: *mut f64,
);

/// Type for global averages calculation
type CalculateGlobalAverages = unsafe extern "C" fn(
    num_channels: i32,
    fuel_temp: *const f64,
    coolant_temp: *const f64,
    graphite_temp: *const f64,
    coolant_void: *const f64,
    local_power: *const f64,
    xenon: *const f64,
    avg_fuel_temp: *mut f64,
    avg_coolant_temp: *mut f64,
    avg_graphite_temp: *mut f64,
    avg_void: *mut f64,
    total_power: *mut f64,
    avg_xenon: *mut f64,
);

/// Input data for spatial simulation
#[derive(Debug, Clone)]
pub struct SpatialChannelInput {
    pub neutron_flux: f64,
    pub precursors: f64,
    pub fuel_temp: f64,
    pub coolant_temp: f64,
    pub graphite_temp: f64,
    pub coolant_void: f64,
    pub iodine: f64,
    pub xenon: f64,
    pub local_rod_worth: f64,
    pub x: f64,
    pub y: f64,
    pub neighbors: Vec<i32>,  // Indices of neighbors (-1 for no neighbor)
}

/// Output data from spatial simulation
#[derive(Debug, Clone)]
pub struct SpatialChannelOutput {
    pub neutron_flux: f64,
    pub precursors: f64,
    pub fuel_temp: f64,
    pub coolant_temp: f64,
    pub graphite_temp: f64,
    pub coolant_void: f64,
    pub iodine: f64,
    pub xenon: f64,
    pub local_power: f64,
    pub local_reactivity: f64,
}

/// Global averages from spatial simulation
#[derive(Debug, Clone)]
pub struct GlobalAverages {
    pub avg_fuel_temp: f64,
    pub avg_coolant_temp: f64,
    pub avg_graphite_temp: f64,
    pub avg_void: f64,
    pub total_power: f64,
    pub avg_xenon: f64,
}

/// Perform one spatial simulation step for all channels
/// 
/// This is the main entry point for 2D physics with independent channels
pub fn spatial_simulation_step(
    dt: f64,
    total_rod_worth: f64,
    scram_active: bool,
    channels: &[SpatialChannelInput],
) -> Vec<SpatialChannelOutput> {
    let lib = get_library();
    let num_channels = channels.len();
    
    if num_channels == 0 {
        return Vec::new();
    }
    
    // Prepare input arrays
    let mut neutron_flux_in = Vec::with_capacity(num_channels);
    let mut precursors_in = Vec::with_capacity(num_channels);
    let mut fuel_temp_in = Vec::with_capacity(num_channels);
    let mut coolant_temp_in = Vec::with_capacity(num_channels);
    let mut graphite_temp_in = Vec::with_capacity(num_channels);
    let mut coolant_void_in = Vec::with_capacity(num_channels);
    let mut iodine_in = Vec::with_capacity(num_channels);
    let mut xenon_in = Vec::with_capacity(num_channels);
    let mut local_rod_worth_in = Vec::with_capacity(num_channels);
    let mut channel_x = Vec::with_capacity(num_channels);
    let mut channel_y = Vec::with_capacity(num_channels);
    let mut neighbor_indices = vec![-1i32; num_channels * MAX_NEIGHBORS];
    let mut num_neighbors_arr = Vec::with_capacity(num_channels);
    
    for (i, ch) in channels.iter().enumerate() {
        neutron_flux_in.push(ch.neutron_flux);
        precursors_in.push(ch.precursors);
        fuel_temp_in.push(ch.fuel_temp);
        coolant_temp_in.push(ch.coolant_temp);
        graphite_temp_in.push(ch.graphite_temp);
        coolant_void_in.push(ch.coolant_void);
        iodine_in.push(ch.iodine);
        xenon_in.push(ch.xenon);
        local_rod_worth_in.push(ch.local_rod_worth);
        channel_x.push(ch.x);
        channel_y.push(ch.y);
        
        // Copy neighbor indices
        let n_neighbors = ch.neighbors.len().min(MAX_NEIGHBORS);
        num_neighbors_arr.push(n_neighbors as i32);
        for (j, &neighbor_idx) in ch.neighbors.iter().take(MAX_NEIGHBORS).enumerate() {
            neighbor_indices[i * MAX_NEIGHBORS + j] = neighbor_idx;
        }
    }
    
    // Prepare output arrays
    let mut neutron_flux_out = vec![0.0f64; num_channels];
    let mut precursors_out = vec![0.0f64; num_channels];
    let mut fuel_temp_out = vec![0.0f64; num_channels];
    let mut coolant_temp_out = vec![0.0f64; num_channels];
    let mut graphite_temp_out = vec![0.0f64; num_channels];
    let mut coolant_void_out = vec![0.0f64; num_channels];
    let mut iodine_out = vec![0.0f64; num_channels];
    let mut xenon_out = vec![0.0f64; num_channels];
    let mut local_power_out = vec![0.0f64; num_channels];
    let mut local_reactivity_out = vec![0.0f64; num_channels];
    
    unsafe {
        let func: Symbol<SpatialSimulationStep> = lib
            .get(b"spatial_simulation_step")
            .expect("Failed to load spatial_simulation_step");
        
        func(
            num_channels as i32,
            dt,
            total_rod_worth,
            if scram_active { 1 } else { 0 },
            neutron_flux_in.as_ptr(),
            precursors_in.as_ptr(),
            fuel_temp_in.as_ptr(),
            coolant_temp_in.as_ptr(),
            graphite_temp_in.as_ptr(),
            coolant_void_in.as_ptr(),
            iodine_in.as_ptr(),
            xenon_in.as_ptr(),
            local_rod_worth_in.as_ptr(),
            neighbor_indices.as_ptr(),
            num_neighbors_arr.as_ptr(),
            channel_x.as_ptr(),
            channel_y.as_ptr(),
            neutron_flux_out.as_mut_ptr(),
            precursors_out.as_mut_ptr(),
            fuel_temp_out.as_mut_ptr(),
            coolant_temp_out.as_mut_ptr(),
            graphite_temp_out.as_mut_ptr(),
            coolant_void_out.as_mut_ptr(),
            iodine_out.as_mut_ptr(),
            xenon_out.as_mut_ptr(),
            local_power_out.as_mut_ptr(),
            local_reactivity_out.as_mut_ptr(),
        );
    }
    
    // Build output vector
    let mut results = Vec::with_capacity(num_channels);
    for i in 0..num_channels {
        results.push(SpatialChannelOutput {
            neutron_flux: neutron_flux_out[i],
            precursors: precursors_out[i],
            fuel_temp: fuel_temp_out[i],
            coolant_temp: coolant_temp_out[i],
            graphite_temp: graphite_temp_out[i],
            coolant_void: coolant_void_out[i],
            iodine: iodine_out[i],
            xenon: xenon_out[i],
            local_power: local_power_out[i],
            local_reactivity: local_reactivity_out[i],
        });
    }
    
    results
}

/// Initialize flux distribution with cosine radial profile
pub fn initialize_flux_distribution(
    channel_x: &[f64],
    channel_y: &[f64],
    initial_power: f64,
) -> Vec<f64> {
    let lib = get_library();
    let num_channels = channel_x.len();
    let mut flux = vec![0.0f64; num_channels];
    
    unsafe {
        let func: Symbol<InitializeFluxDistribution> = lib
            .get(b"initialize_flux_distribution")
            .expect("Failed to load initialize_flux_distribution");
        
        func(
            num_channels as i32,
            channel_x.as_ptr(),
            channel_y.as_ptr(),
            initial_power,
            flux.as_mut_ptr(),
        );
    }
    
    flux
}

/// Calculate global averages from per-channel data
pub fn calculate_global_averages(
    fuel_temp: &[f64],
    coolant_temp: &[f64],
    graphite_temp: &[f64],
    coolant_void: &[f64],
    local_power: &[f64],
    xenon: &[f64],
) -> GlobalAverages {
    let lib = get_library();
    let num_channels = fuel_temp.len();
    
    let mut avg_fuel_temp = 0.0f64;
    let mut avg_coolant_temp = 0.0f64;
    let mut avg_graphite_temp = 0.0f64;
    let mut avg_void = 0.0f64;
    let mut total_power = 0.0f64;
    let mut avg_xenon = 0.0f64;
    
    unsafe {
        let func: Symbol<CalculateGlobalAverages> = lib
            .get(b"calculate_global_averages")
            .expect("Failed to load calculate_global_averages");
        
        func(
            num_channels as i32,
            fuel_temp.as_ptr(),
            coolant_temp.as_ptr(),
            graphite_temp.as_ptr(),
            coolant_void.as_ptr(),
            local_power.as_ptr(),
            xenon.as_ptr(),
            &mut avg_fuel_temp,
            &mut avg_coolant_temp,
            &mut avg_graphite_temp,
            &mut avg_void,
            &mut total_power,
            &mut avg_xenon,
        );
    }
    
    GlobalAverages {
        avg_fuel_temp,
        avg_coolant_temp,
        avg_graphite_temp,
        avg_void,
        total_power,
        avg_xenon,
    }
}

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
